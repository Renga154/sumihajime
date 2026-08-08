import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * なぜ: docs/data-sources/registry.csv の notes 列は publish が D1 の sources テーブルへ書き込み、
 * GET /api/procedures/:id が根拠カードの一部として利用者に返す(GET /api/sources は notes を
 * 落とすため見落としやすい経路。sourceLedgerEntrySchema 参照)。
 *
 * 背景(2026-08-08): 世田谷区のごみ確認の根拠カードに、要件番号(C-9)・タスクID(T-005)・
 * 内部ソースID(src-13112-waste_schedule-001)がそのまま表示されていた。この列が利用者向け表示と
 * 内部の来歴記録を兼ねる二重用途になっているため、機械的な固定なしでは開発が進むたびに内部用語が
 * 混入する(docs/research/judge-audit-2026-08-07.md に構造的観察として記録)。
 * 同時に data/normalized/**\/procedures.json の公開フィールド(shortDescription/cautions等)
 * にも同種の混入(「誠実縮退」「waste_schedule」等の内部enum名、R-1のような監査ID)が見つかった
 * ため、あわせてこのテストの対象に含める。
 *
 * 固定する不変条件:
 *   1. registry.csv の notes 列(全行)に、内部識別子・開発工程語が含まれない。
 *   2. data/normalized/{code}/procedures.json の公開フィールド
 *      (title/shortDescription/applicabilityReason/dueDescription/locations/contact/cautions)
 *      に同様の内部識別子・開発工程語が含まれない。
 *   3. data/normalized/{code}/facilities.json の公開フィールド(name/category/address/hours)も同様。
 *
 * 対象外(意図的): registry.csv の notes 以外の列で publish が読まない内部管理列(reviewer 等)、
 * facilities.json/procedures.json の来歴専用フィールド(note/dataQualityNotes/extractionNote。
 * cross-ward-text.test.ts の方針と同じ=publish が読まず利用者へ出ない)。
 *
 * 手本: cross-ward-text.test.ts / registry-review-status.test.ts(公開経路を持つフィールドを
 * 走査して不変条件を固定するパターン)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/**
 * 検査パターン。要件番号・タスクID・文書ID・内部ソースIDは接頭辞+数字の形をしているため
 * 正規表現で機械的に検出できる。開発工程語は接頭辞化できない自然文の断片なので固定文字列の
 * リストで持つ。
 *
 * 注意: 日本語(かな/漢字)は JavaScript の `\b` において「単語構成文字」とはみなされないため、
 * 素朴に `/\bsrc-[\w-]+\b/` としても和文に直接続く場合に末尾の `\b` が機能しないことがある
 * (例: 「src-13115-facilities-002で補完」)。文字クラス自体を src- の許容文字だけに絞ることで
 * 終端境界を \b に頼らずに済ませる。
 */
const ID_PATTERNS: readonly { readonly label: string; readonly regex: RegExp }[] = [
  { label: '要件番号(C-数字)', regex: /(?<![A-Za-z0-9])C-\d+(?![0-9])/g },
  { label: 'タスクID(T-数字)', regex: /(?<![A-Za-z0-9])T-\d+[a-z]?(?![0-9a-z])/g },
  { label: '文書ID(ADR-数字)', regex: /ADR-\d+/g },
  { label: 'リスク/監査ID(R-数字)', regex: /(?<![A-Za-z0-9])R-\d+(?![0-9])/g },
  { label: '内部ソースID(src-*)', regex: /src-[A-Za-z0-9_-]+/g },
];

/**
 * 開発工程・内部運用の語。「のような」で例示された語に限らず、実際に混入が見つかった語を
 * 追加してきたリスト。新しい混入語が見つかったらここへ追記する(黙って緩めるのではなく増やす)。
 */
const DEV_PROCESS_TERMS: readonly string[] = [
  '決裁',
  'maintainer',
  'review_status',
  'dueRule',
  'dueDescription', // フィールド名としての言及(値そのものは対象外の列で使う分には出ない)
  '実ファイル検証済み',
  'へ正規化',
  '公開ゲート',
  '人手レビュー承認',
  '人手レビューで要確認', // 内部レビュー工程を主語にした言い回し
  '誠実縮退',
  '捏造回避',
  '本バッチ',
  'docs/research',
  'scripts/',
  'SHA-256',
  'waste_schedule',
  'waste_sorting',
  'procedure_',
];

// Batch7 / Step4-A / Wave2 のような「工程名+連番」も一括で拾う。
const BATCH_STEP_WAVE_REGEX = /\b(?:Batch|Step|Wave)\d+/g;

interface Finding {
  readonly source: string;
  readonly field: string;
  readonly label: string;
  readonly text: string;
}

function findViolations(text: string, source: string, field: string): Finding[] {
  const out: Finding[] = [];
  for (const { label, regex } of ID_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) out.push({ source, field, label, text });
  }
  if (BATCH_STEP_WAVE_REGEX.test(text)) {
    BATCH_STEP_WAVE_REGEX.lastIndex = 0;
    out.push({ source, field, label: '工程名+連番(Batch/Step/Wave)', text });
  }
  for (const term of DEV_PROCESS_TERMS) {
    if (text.includes(term)) out.push({ source, field, label: `開発工程語「${term}」`, text });
  }
  return out;
}

/**
 * 例外(誤検知ではなく、その語が利用者向けとして正当な内容であるケース)。
 * 黙って緩めない: 追加するときは reason を書くこと。
 */
interface AllowedMention {
  readonly source: string;
  readonly field: string;
  readonly textIncludes: string;
  readonly reason: string;
}

const ALLOWLIST: readonly AllowedMention[] = [];

function isAllowed(f: Finding): boolean {
  return ALLOWLIST.some(
    (a) => a.source === f.source && a.field === f.field && f.text.includes(a.textIncludes),
  );
}

/** 引用符つきCSVの最小パーサ(notes 列がカンマ・改行を含むため split(',') では読めない)。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function registryFindings(): Finding[] {
  const rows = parseCsv(readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8'));
  const header = rows[0] ?? [];
  const idIdx = header.indexOf('source_id');
  const notesIdx = header.indexOf('notes');
  const out: Finding[] = [];
  for (const row of rows.slice(1)) {
    const sourceId = row[idIdx];
    if (!sourceId) continue;
    out.push(...findViolations(row[notesIdx] ?? '', sourceId, 'notes'));
  }
  return out;
}

const PROC_PUBLIC_FIELDS = [
  'title',
  'shortDescription',
  'applicabilityReason',
  'dueDescription',
  'locations',
  'contact',
  'cautions',
] as const;

const FAC_PUBLIC_FIELDS = ['name', 'category', 'address', 'hours'] as const;

const WARDS: readonly string[] = readdirSync(resolve(repoRoot, 'data/normalized'))
  .filter((name) => /^\d{5}$/.test(name))
  .sort();

function normalizedFindingsFor(code: string): Finding[] {
  const out: Finding[] = [];

  const procPath = resolve(repoRoot, `data/normalized/${code}/procedures.json`);
  const procJson = JSON.parse(readFileSync(procPath, 'utf-8')) as {
    procedures?: Record<string, unknown>[];
  };
  for (const proc of procJson.procedures ?? []) {
    const procId = typeof proc.id === 'string' ? proc.id : `${code}?`;
    for (const field of PROC_PUBLIC_FIELDS) {
      const value = proc[field];
      const texts = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      for (const t of texts) {
        if (typeof t === 'string') out.push(...findViolations(t, `procedures:${procId}`, field));
      }
    }
  }

  const facPath = resolve(repoRoot, `data/normalized/${code}/facilities.json`);
  const facJson = JSON.parse(readFileSync(facPath, 'utf-8')) as {
    facilities?: Record<string, unknown>[];
  };
  for (const fac of facJson.facilities ?? []) {
    const facId = typeof fac.facilityId === 'string' ? fac.facilityId : `${code}?`;
    for (const field of FAC_PUBLIC_FIELDS) {
      const value = fac[field];
      if (typeof value === 'string')
        out.push(...findViolations(value, `facilities:${facId}`, field));
    }
  }

  return out;
}

function describeFindings(findings: readonly Finding[]): string {
  return findings
    .map((f) => `\n  [${f.source}] ${f.field}: ${f.label}\n    text: ${f.text}`)
    .join('\n');
}

describe('公開データに内部識別子・開発工程語を含まない(registry.csv notes / procedures / facilities)', () => {
  it('registry.csv が読め、notes 列を持つ行が存在する', () => {
    const findings = registryFindings();
    expect(Array.isArray(findings)).toBe(true);
  });

  it('registry.csv の notes 列(全行)に内部識別子・開発工程語が含まれない', () => {
    const findings = registryFindings().filter((f) => !isAllowed(f));
    expect(findings, describeFindings(findings)).toEqual([]);
  });

  it.each(WARDS)(
    '%s: procedures.json / facilities.json の公開フィールドに内部識別子が含まれない',
    (code) => {
      const findings = normalizedFindingsFor(code).filter((f) => !isAllowed(f));
      expect(findings, describeFindings(findings)).toEqual([]);
    },
  );

  it('全区・全出典を合わせても内部識別子の混入が0件', () => {
    // なぜ: it.each は行/区ごとに落ちるが、総数0であること自体を1本の不変条件として残す。
    const all = [...registryFindings(), ...WARDS.flatMap(normalizedFindingsFor)].filter(
      (f) => !isAllowed(f),
    );
    expect(all, describeFindings(all)).toHaveLength(0);
  });

  it('検出ロジックが実際に内部識別子を捕まえる(テスト自体の有効性=サニティチェック)', () => {
    // なぜ: 「常に空配列を返すだけのテスト」に劣化していないことを保証する。
    // 実際にあった違反文言を模したケースを1つずつ流し、全パターンが発火することを確認する。
    expect(findViolations('祝日等の例外(C-9)。', 'test', 'notes').length).toBeGreaterThan(0);
    expect(findViolations('T-005取得。', 'test', 'notes').length).toBeGreaterThan(0);
    expect(
      findViolations('公開ゲート(ADR-007)の公開対象。', 'test', 'notes').length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('収集曜日CSV(src-13112-waste_schedule-001)の出典ページ。', 'test', 'notes')
        .length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('src-13115-facilities-002で補完。', 'test', 'notes').length,
      '和文に直接続く src- 参照も検出できること(\\b 境界の落とし穴の回帰)',
    ).toBeGreaterThan(0);
    expect(
      findViolations('2026-08-07 ユーザー(maintainer)決裁により承認済み。', 'test', 'notes').length,
    ).toBeGreaterThan(0);
    expect(findViolations('Batch7(2026-08-07)で取得。', 'test', 'notes').length).toBeGreaterThan(0);
    expect(
      findViolations('推測で曜日を作らない(誠実縮退)。', 'test', 'shortDescription').length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('収集曜日データ(waste_schedule)を作成していません。', 'test', 'cautions')
        .length,
    ).toBeGreaterThan(0);

    // 正当な利用者向け文言は誤検知しない。
    expect(findViolations('祝日・年末年始の例外はカレンダーで要確認。', 'test', 'notes')).toEqual(
      [],
    );
    expect(findViolations('丁目範囲の粒度で提供(例: 赤堤1・3〜5)。', 'test', 'notes')).toEqual([]);
    expect(
      findViolations(
        '窓口は戸籍住民課住民記録係(本庁舎2階4番)と地域事務所5か所。',
        'test',
        'notes',
      ),
    ).toEqual([]);
  });

  it('allowlist の各エントリは実際に使われている(不要な緩和を残さない)', () => {
    if (ALLOWLIST.length === 0) return; // 現時点で許可リストは空(意図的)。
    const all = [...registryFindings(), ...WARDS.flatMap(normalizedFindingsFor)];
    for (const entry of ALLOWLIST) {
      const used = all.some(
        (f) =>
          f.source === entry.source &&
          f.field === entry.field &&
          f.text.includes(entry.textIncludes),
      );
      expect(used, `未使用の allowlist: ${entry.source} / ${entry.field}`).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});
