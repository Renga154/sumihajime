import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { VectorizeMatch, VectorizeQueryOptions, VectorizeQueryable } from '@tmn/rag';
import { PERSONAL_INFO_MESSAGE } from '@tmn/domain';
import { createTestDb, type TestDb } from '../test/d1-harness.js';
import { app } from './index.js';
import { getProcedureVersion, getProcedureVersions, getRagChunks } from './db.js';

/**
 * なぜ: 2026-10-02 のセキュリティ監査(書籍『Webアプリケーションセキュリティ入門』準拠)で見つかった
 * チャット経路の穴を、Miniflare の本物のD1 + モックVectorize + スタブOpenAI で通しで固定する。
 * 各項目は「攻撃(拒否・保留される)」と「正常系(従来どおり答える)」を対で持つ。
 *
 *  1. 巡回が更新を検知したソース(ADR-014)を引用した回答に stale 警告が付く(§11.5)
 *  2. 承認を外れたソースのチャンクは検索で見つかっても使わない(§11.3 reviewStatus=approved)
 *     / 手続きは現行版(procedures.current_version)だけを読む
 *  3. 別の区の公式URL・抜粋に無い電話番号/メールを含む生成回答は保留(原則4・§11.6)
 *  4. OPENAI_BASE_URL が許可外なら鍵を送らずに 503
 *  5. 個人情報(電話・メール・マイナンバー)を含む質問は 422 で、外部へ送らない(原則6)
 *  6. 検索は Vectorize のフィルタと D1 の両方で選択自治体に閉じる(二重スコープ)
 *
 * 世田谷(13112)と江東(13108)を同じD1へ載せ、越境の混入を実データで確かめる。
 */

let harness: TestDb;
let db: D1Database;

const SETAGAYA = '13112';
const KOTO = '13108';
const SG_SOURCE = 'src-13112-resident_registration-001';
const SG_CHUNK = `${SG_SOURCE}#0`;
const SG_CHUNK_TEXT =
  '転入届は引越しをしてきた日から14日以内に窓口へ提出してください。' +
  'お問い合わせ 世田谷区役所 住民記録・戸籍課 電話：03-5432-3333 jumin@city.setagaya.lg.jp';
const KOTO_SOURCE = 'src-13108-resident_registration-001';
const KOTO_CHUNK = `${KOTO_SOURCE}#0`;
const SG_INSURANCE_SOURCE = 'src-13112-national_health_insurance-001';
const SG_INSURANCE_CHUNK = `${SG_INSURANCE_SOURCE}#0`;

async function insertChunk(
  chunkId: string,
  code: string,
  sourceId: string,
  category: string,
  text: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rag_chunks (chunk_id, municipality_code, source_id, procedure_id, category, ` +
        `title, url, last_verified_at, seq, text) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      chunkId,
      code,
      sourceId,
      null,
      category,
      `${code} ${category}`,
      'https://example.lg.jp/',
      '2026-07-21T00:00:00Z',
      0,
      text,
    )
    .run();
}

beforeAll(async () => {
  harness = await createTestDb([SETAGAYA, KOTO]);
  db = harness.db as unknown as D1Database;
  await insertChunk(SG_CHUNK, SETAGAYA, SG_SOURCE, 'resident_registration', SG_CHUNK_TEXT);
  await insertChunk(
    KOTO_CHUNK,
    KOTO,
    KOTO_SOURCE,
    'resident_registration',
    '江東区の転入届は14日以内に区民課へ。',
  );
  await insertChunk(
    SG_INSURANCE_CHUNK,
    SETAGAYA,
    SG_INSURANCE_SOURCE,
    'national_health_insurance',
    '国民健康保険の加入届は転入から14日以内に届け出てください。',
  );
});

afterAll(async () => {
  await harness.dispose();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.prepare('DELETE FROM source_drift').run();
});

interface FetchSpy {
  calls: string[];
  /** chat/completions に渡された user メッセージ(プロンプトの検査用)。 */
  prompts: string[];
}

/** OpenAI(embeddings/chat)への fetch をスタブし、呼ばれたURLと送られたプロンプトを記録する。 */
function stubOpenAI(chatContent: string): FetchSpy {
  const spy: FetchSpy = { calls: [], prompts: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      spy.calls.push(url);
      if (url.endsWith('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        spy.prompts.push(body.messages.map((m) => m.content).join('\n'));
        return new Response(JSON.stringify({ choices: [{ message: { content: chatContent } }] }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return spy;
}

interface CapturingVectorize extends VectorizeQueryable {
  filters: Record<string, unknown>[];
}

function mockVectorize(matches: VectorizeMatch[]): CapturingVectorize {
  const idx: CapturingVectorize = {
    filters: [],
    async query(_vector: number[], opts: VectorizeQueryOptions) {
      idx.filters.push(opts.filter ?? {});
      return { matches };
    },
  };
  return idx;
}

let ipCounter = 0;
function env(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB: db,
    RAG_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    RAG_MIN_SCORE: '0.3',
    ...overrides,
  };
}

function chat(e: Record<string, unknown>, municipalityCode: string, question: string) {
  ipCounter += 1;
  return Promise.resolve(
    app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `10.9.0.${ipCounter}` },
        body: JSON.stringify({ municipalityCode, question }),
      },
      e,
    ),
  );
}

interface ChatBody {
  answer: string;
  abstained: boolean;
  confidence: string;
  citations: { sourceId: string; url: string; driftDetectedOn?: string; driftKind?: string }[];
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return logs;
}

async function insertDriftMark(sourceId: string, status = 'changed'): Promise<void> {
  const row = await db
    .prepare('SELECT last_verified_at FROM sources WHERE source_id = ?')
    .bind(sourceId)
    .first<{ last_verified_at: string }>();
  await db
    .prepare(
      'INSERT INTO source_drift (source_id, status, reason, detected_at, verified_at_seen, ' +
        'last_checked_at, consecutive_failures) VALUES (?, ?, ?, ?, ?, ?, 0)',
    )
    .bind(
      sourceId,
      status,
      'page_updated_on_changed',
      '2026-09-22T03:00:00Z',
      row?.last_verified_at ?? null,
      '2026-09-22T03:00:00Z',
    )
    .run();
}

const RAG_QUESTION = '転入届はいつまでに出せばよいですか?';
const RAG_ANSWER = `転入届は引越し日から14日以内に窓口へ提出してください。\nSOURCES: ${SG_SOURCE}`;

describe('1. 巡回が更新を検知したソースを引用した回答には stale 警告を付ける(§11.5)', () => {
  it('RAG経路: 引用に検知日・種類が付き、確度は low(要確認)へ下がる。公式リンクは残る', async () => {
    await insertDriftMark(SG_SOURCE);
    stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({ VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
      SETAGAYA,
      RAG_QUESTION,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatBody;
    expect(body.abstained).toBe(false);
    expect(body.confidence).toBe('low');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({
      sourceId: SG_SOURCE,
      driftKind: 'changed',
      driftDetectedOn: '2026-09-22',
    });
    expect(body.citations[0]?.url).toMatch(/^https:\/\/www\.city\.setagaya\.lg\.jp\//);
  });

  it('RAG経路: 到達不能(unreachable)も同じく警告対象', async () => {
    await insertDriftMark(SG_SOURCE, 'unreachable');
    stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({ VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
      SETAGAYA,
      RAG_QUESTION,
    );
    const body = (await res.json()) as ChatBody;
    expect(body.citations[0]?.driftKind).toBe('unreachable');
    expect(body.confidence).toBe('low');
  });

  it('RAG経路(正常系): 検知が無ければ警告項目は付かず、確度は従来どおり', async () => {
    stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({ VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
      SETAGAYA,
      RAG_QUESTION,
    );
    const body = (await res.json()) as ChatBody;
    expect(body.abstained).toBe(false);
    expect(body.confidence).toBe('high');
    expect(body.citations[0]).not.toHaveProperty('driftKind');
    expect(body.citations[0]).not.toHaveProperty('driftDetectedOn');
  });

  it('検証済みデータ経路(必要書類): 根拠ソースの検知が引用に載り、確度は low へ下がる', async () => {
    await insertDriftMark(SG_SOURCE);
    const res = await chat(env(), SETAGAYA, '転入届に必要な持ち物は？');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatBody;
    expect(body.abstained).toBe(false);
    expect(body.confidence).toBe('low');
    const cite = body.citations.find((c) => c.sourceId === SG_SOURCE);
    expect(cite).toMatchObject({ driftKind: 'changed', driftDetectedOn: '2026-09-22' });
  });

  it('検証済みデータ経路(正常系): 検知が無ければ high のまま・警告項目なし', async () => {
    const res = await chat(env(), SETAGAYA, '転入届に必要な持ち物は？');
    const body = (await res.json()) as ChatBody;
    expect(body.confidence).toBe('high');
    for (const c of body.citations) expect(c).not.toHaveProperty('driftKind');
  });

  it('他区(江東)の検知は世田谷の回答に影響しない(自治体スコープの分離)', async () => {
    await insertDriftMark(KOTO_SOURCE);
    const res = await chat(env(), SETAGAYA, '転入届に必要な持ち物は？');
    const body = (await res.json()) as ChatBody;
    expect(body.confidence).toBe('high');
    for (const c of body.citations) expect(c).not.toHaveProperty('driftKind');
  });
});

describe('2. 承認を外れたソースのチャンク・旧版の手続きは使わない', () => {
  it('台帳から外れた(再publishで消えた)ソースのチャンクは、検索で当たっても抜粋に入らない', async () => {
    // 正常系: 承認済みのうちは使われる。
    expect((await getRagChunks(db, SETAGAYA, [SG_INSURANCE_CHUNK])).has(SG_INSURANCE_CHUNK)).toBe(
      true,
    );

    const saved = await db
      .prepare('SELECT * FROM sources WHERE source_id = ?')
      .bind(SG_INSURANCE_SOURCE)
      .first<Record<string, unknown>>();
    expect(saved).toBeTruthy();
    // rag_chunks は publish の DELETE→INSERT 対象外なので、ソースの承認が外れてもチャンクが残る。
    await db.prepare('DELETE FROM sources WHERE source_id = ?').bind(SG_INSURANCE_SOURCE).run();
    try {
      expect((await getRagChunks(db, SETAGAYA, [SG_INSURANCE_CHUNK])).size).toBe(0);

      const spy = stubOpenAI(`加入届は14日以内です。\nSOURCES: ${SG_INSURANCE_SOURCE}`);
      const res = await chat(
        env({ VECTORIZE: mockVectorize([{ id: SG_INSURANCE_CHUNK, score: 0.9 }]) }),
        SETAGAYA,
        '国民健康保険はいつまでに加入しますか',
      );
      const body = (await res.json()) as ChatBody;
      expect(body.abstained).toBe(true);
      // 生成(chat/completions)へは進まない=未承認の本文がプロンプトに載らない。
      expect(spy.calls.some((u) => u.endsWith('/chat/completions'))).toBe(false);
    } finally {
      const cols = Object.keys(saved!);
      await db
        .prepare(
          `INSERT INTO sources (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        )
        .bind(...cols.map((k) => saved![k]))
        .run();
    }
  });

  it('review_status が approved 以外になったソースのチャンクも使わない', async () => {
    await db
      .prepare("UPDATE sources SET review_status = 'stale' WHERE source_id = ?")
      .bind(SG_INSURANCE_SOURCE)
      .run();
    try {
      expect((await getRagChunks(db, SETAGAYA, [SG_INSURANCE_CHUNK])).size).toBe(0);
    } finally {
      await db
        .prepare("UPDATE sources SET review_status = 'approved' WHERE source_id = ?")
        .bind(SG_INSURANCE_SOURCE)
        .run();
    }
  });

  it('有効期間(effective_from/to)外のソースのチャンクは使わない(§11.3)', async () => {
    await db
      .prepare("UPDATE sources SET effective_to = '2020-03-31' WHERE source_id = ?")
      .bind(SG_INSURANCE_SOURCE)
      .run();
    try {
      expect((await getRagChunks(db, SETAGAYA, [SG_INSURANCE_CHUNK], '2026-10-02')).size).toBe(0);
      // 期間内(境界日を含む)なら使う。
      expect((await getRagChunks(db, SETAGAYA, [SG_INSURANCE_CHUNK], '2020-03-31')).size).toBe(1);
    } finally {
      await db
        .prepare('UPDATE sources SET effective_to = NULL WHERE source_id = ?')
        .bind(SG_INSURANCE_SOURCE)
        .run();
    }
  });

  it('手続きは procedures.current_version の版だけを読む(旧版の行が残っていても混ざらない)', async () => {
    const current = await getProcedureVersion(db, SETAGAYA, 'procedure_resident_registration');
    expect(current).not.toBeNull();
    // 旧版の行を足す(版文字列は現行より辞書順で前=索引順で先に読まれる位置)。
    await db
      .prepare(
        'INSERT INTO procedure_versions SELECT procedure_id, ?, municipality_code, canonical_type, ' +
          "'旧版の手続き名', short_description, applicability_reason, priority, due_date, " +
          'due_description, required_documents, channels, locations, online_url, contact, ' +
          'source_ids, last_verified_at, data_status, cautions FROM procedure_versions ' +
          'WHERE municipality_code = ? AND procedure_id = ?',
      )
      .bind('0000-01-01.1', SETAGAYA, 'procedure_resident_registration')
      .run();
    await db
      .prepare(
        'INSERT INTO procedure_versions SELECT procedure_id, ?, municipality_code, canonical_type, ' +
          "'旧版の手続き名', short_description, applicability_reason, priority, due_date, " +
          'due_description, required_documents, channels, locations, online_url, contact, ' +
          'source_ids, last_verified_at, data_status, cautions FROM procedure_versions ' +
          'WHERE municipality_code = ? AND procedure_id = ? AND version = ?',
      )
      .bind('9999-12-31.1', SETAGAYA, 'procedure_resident_registration', current!.version)
      .run();
    try {
      const one = await getProcedureVersion(db, SETAGAYA, 'procedure_resident_registration');
      expect(one?.version).toBe(current!.version);
      expect(one?.title).toBe(current!.title);
      const all = await getProcedureVersions(db, SETAGAYA);
      expect(all.get('procedure_resident_registration')?.version).toBe(current!.version);
      expect(all.get('procedure_resident_registration')?.title).not.toBe('旧版の手続き名');
    } finally {
      await db
        .prepare("DELETE FROM procedure_versions WHERE version IN ('0000-01-01.1', '9999-12-31.1')")
        .run();
    }
  });
});

describe('3. 選択自治体の根拠に無いURL・連絡先を含む生成回答は保留(原則4・§11.6)', () => {
  async function ask(answer: string): Promise<{ body: ChatBody; logs: string[] }> {
    const logs = captureLogs();
    stubOpenAI(`${answer}\nSOURCES: ${SG_SOURCE}`);
    const res = await chat(
      env({ VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
      SETAGAYA,
      RAG_QUESTION,
    );
    expect(res.status).toBe(200);
    return { body: (await res.json()) as ChatBody, logs };
  }

  it('別の区(江東区)の公式URLは .lg.jp でも保留にする', async () => {
    const { body, logs } = await ask(
      '転入届は14日以内です。詳しくは https://www.city.koto.lg.jp/kurashi/index.html をご覧ください。',
    );
    expect(body.abstained).toBe(true);
    expect(body.citations).toHaveLength(0);
    expect(body.answer).not.toContain('koto');
    const joined = logs.join('\n');
    expect(joined).toContain('chat.rejected_untrusted_url');
    expect(joined).not.toContain('koto.lg.jp');
  });

  it('台帳に無い国の公式URL(.go.jp)も、抜粋に書かれていなければ保留にする', async () => {
    const { body } = await ask('詳しくは https://www.soumu.go.jp/ をご覧ください。');
    expect(body.abstained).toBe(true);
  });

  it('(正常系)自区・自区の手続きが根拠にする都・国の承認済みホストは答える', async () => {
    const { body } = await ask(
      '転入届は14日以内です(https://www.city.setagaya.lg.jp/02233/88.html)。' +
        '水道は https://www.waterworks.metro.tokyo.lg.jp/ 、郵便は https://www.post.japanpost.jp/ へ。',
    );
    expect(body.abstained).toBe(false);
  });

  it('抜粋に無い電話番号・メールアドレスは保留にする(質問から写された・捏造された連絡先)', async () => {
    for (const answer of [
      '転入届は14日以内です。お急ぎの方は 090-9999-0000 へお電話ください。',
      '転入届は14日以内です。お問い合わせは 03-5432-9999 まで。',
      '転入届は14日以内です。質問は help@evil.example へ。',
    ]) {
      const { body, logs } = await ask(answer);
      expect(body.abstained, answer).toBe(true);
      const joined = logs.join('\n');
      expect(joined).toContain('chat.rejected_untrusted_url');
      expect(joined).not.toContain('9999');
      expect(joined).not.toContain('evil.example');
    }
  });

  it('(正常系)抜粋にある電話番号・メールは表記が変わっても答える', async () => {
    const { body } = await ask(
      '転入届は14日以内です。住民記録・戸籍課(03(5432)3333、jumin@city.setagaya.lg.jp)へ。',
    );
    expect(body.abstained).toBe(false);
  });

  it('(正常系)日付・郵便番号・金額・時刻を電話番号と取り違えて保留にしない', async () => {
    const { body } = await ask(
      '2026年4月1日以降、〒154-0017 の窓口で受け付けます。手数料は15,000円、受付は08:30～17:15です。',
    );
    expect(body.abstained).toBe(false);
  });
});

describe('4. OPENAI_BASE_URL が許可外なら鍵を送らない', () => {
  it('許可外の宛先では OpenAI へ1度も接続せず 503 の標準エラー', async () => {
    for (const baseUrl of [
      'https://evil.example/v1',
      'http://api.openai.com/v1',
      'https://api.openai.com@evil.example/v1',
    ]) {
      const spy = stubOpenAI(RAG_ANSWER);
      const res = await chat(
        env({ OPENAI_BASE_URL: baseUrl, VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
        SETAGAYA,
        RAG_QUESTION,
      );
      expect(res.status, baseUrl).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('chat_unavailable');
      expect(JSON.stringify(body)).not.toContain('evil');
      expect(spy.calls).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('許可外の宛先でも、検証済みデータで答える必要書類の質問は答えられる(原則8)', async () => {
    const spy = stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({ OPENAI_BASE_URL: 'https://evil.example/v1' }),
      SETAGAYA,
      '転入届に必要な持ち物は？',
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ChatBody).abstained).toBe(false);
    expect(spy.calls).toEqual([]);
  });

  it('(正常系)Cloudflare AI Gateway の宛先は使える', async () => {
    const spy = stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({
        OPENAI_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
        VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]),
      }),
      SETAGAYA,
      RAG_QUESTION,
    );
    expect(res.status).toBe(200);
    expect(spy.calls.every((u) => u.startsWith('https://gateway.ai.cloudflare.com/'))).toBe(true);
  });
});

describe('5. 個人情報を含む質問は 422 で断り、外部へ送らない(原則6)', () => {
  it.each([
    ['電話番号', '転入届について 090-1234-5678 に折り返しください'],
    ['メールアドレス', '結果を taro@example.com に送ってもらえますか'],
    ['マイナンバー', '私のマイナンバー 1234 5678 9012 で手続きできますか'],
  ])('%s を含む質問は 422・入力を反射しない・ログにも残さない・外部を呼ばない', async (_l, q) => {
    const logs = captureLogs();
    const spy = stubOpenAI(RAG_ANSWER);
    const vz = mockVectorize([{ id: SG_CHUNK, score: 0.8 }]);
    const before = await db
      .prepare('SELECT SUM(count) AS n FROM chat_usage')
      .first<{ n: number }>();

    const res = await chat(env({ VECTORIZE: vz }), SETAGAYA, q);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('personal_info_detected');
    expect(body.error.message).toBe(PERSONAL_INFO_MESSAGE);
    const raw = JSON.stringify(body);
    for (const fragment of ['5678', 'taro', '9012']) expect(raw).not.toContain(fragment);
    const joined = logs.join('\n');
    expect(joined).toContain('error.personal_info_detected');
    for (const fragment of ['5678', 'taro', '9012', '転入届について']) {
      expect(joined).not.toContain(fragment);
    }
    expect(spy.calls).toEqual([]);
    expect(vz.filters).toEqual([]);
    const after = await db.prepare('SELECT SUM(count) AS n FROM chat_usage').first<{ n: number }>();
    expect(after?.n ?? 0).toBe(before?.n ?? 0);
  });

  it('(正常系)日付・郵便番号・金額を含む普通の質問は断らない', async () => {
    stubOpenAI(RAG_ANSWER);
    const res = await chat(
      env({ VECTORIZE: mockVectorize([{ id: SG_CHUNK, score: 0.8 }]) }),
      SETAGAYA,
      '2026年4月1日に〒154-0017へ転入します。15,000円かかりますか？転入届はいつまで？',
    );
    expect(res.status).toBe(200);
  });
});

describe('6. 検索は Vectorize のフィルタと D1 の両方で選択自治体に閉じる(二重スコープ §11.3)', () => {
  it('Vectorize には選択自治体の $eq フィルタを必ず渡す', async () => {
    stubOpenAI(RAG_ANSWER);
    const vz = mockVectorize([{ id: SG_CHUNK, score: 0.8 }]);
    await chat(env({ VECTORIZE: vz }), SETAGAYA, RAG_QUESTION);
    expect(vz.filters).toEqual([{ municipalityCode: SETAGAYA }]);
  });

  it('Vectorize が他区のチャンクIDを返しても D1 側で落ち、生成へ進まず保留する', async () => {
    const logs = captureLogs();
    const spy = stubOpenAI(`江東区の転入届は14日以内です。\nSOURCES: ${KOTO_SOURCE}`);
    // フィルタが効かなかった(索引のメタデータ不整合等)場合を模して、江東のチャンクだけを返す。
    const vz = mockVectorize([{ id: KOTO_CHUNK, score: 0.95 }]);
    const res = await chat(env({ VECTORIZE: vz }), SETAGAYA, RAG_QUESTION);
    const body = (await res.json()) as ChatBody;
    expect(body.abstained).toBe(true);
    expect(body.citations).toHaveLength(0);
    expect(spy.calls.some((u) => u.endsWith('/chat/completions'))).toBe(false);
    expect(logs.join('\n')).toContain('no_scoped_chunks');
    // D1 関数単体でも、他区のIDは選択自治体の問い合わせに現れない。
    expect((await getRagChunks(db, SETAGAYA, [KOTO_CHUNK, SG_CHUNK])).has(KOTO_CHUNK)).toBe(false);
  });

  it('自区と他区のIDが混ざって返っても、プロンプトには自区の抜粋だけが載る', async () => {
    const spy = stubOpenAI(RAG_ANSWER);
    const vz = mockVectorize([
      { id: KOTO_CHUNK, score: 0.95 },
      { id: SG_CHUNK, score: 0.8 },
    ]);
    const res = await chat(env({ VECTORIZE: vz }), SETAGAYA, RAG_QUESTION);
    expect(((await res.json()) as ChatBody).abstained).toBe(false);
    expect(spy.prompts).toHaveLength(1);
    expect(spy.prompts[0]).toContain(SG_SOURCE);
    expect(spy.prompts[0]).not.toContain(KOTO_SOURCE);
    expect(spy.prompts[0]).not.toContain('江東区の転入届');
  });
});
