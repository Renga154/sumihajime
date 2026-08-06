import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * なぜ: CLAUDE.md原則4「選択自治体と異なる自治体の情報を混ぜない」を、全区総当たりで機械的に固定する。
 *
 * 背景(2026-08-07): 各区の cautions / dueDescription / needsConfirmationReason に
 * 「この区の値は◯◯だが、△△区は□□」という自治体差分の解説が書かれていた。書いた側の意図は
 * 「他区の値を持ち込んでいない」ことの説明だったが、結果としてその説明文自体が他区の区名と
 * 期限値を利用者へ表示してしまっていた(千代田区の利用者に新宿区の『14日以内』が見えている状態)。
 * 原則4が防ごうとしている害そのものなので、説明の丁寧さでは防げない=テストで固定する。
 *
 * 固定する不変条件:
 *   ある区の公開データの文字列に、他の22特別区の名称(完全形「◯◯区」)が現れない。
 *
 * 判定を完全形に限る理由(短縮形を使わない):
 *   短縮形は地名・施設名・方角と衝突して誤検知が避けられない。実データにある例:
 *     - 「運転免許試験場(府中・鮫洲・江東)」「運転免許更新センター(神田・新宿)」(警視庁の施設名)
 *     - 中野区のごみ収集地域「東中野」、荒川区保健所の「北庁舎」、板橋区役所の「北館」
 *   完全形「◯◯区」なら、これらは一切ヒットしない。逆に完全形をすり抜ける短縮形の混入は
 *   このテストでは捕まえられないため、データ追加時のレビュー観点としては残る(既知の限界)。
 *
 * 検査対象は「公開経路に載りうるデータ」。source registry(docs/data-sources/registry.csv)の
 * source_title / attribution_text / notes は publish が sources テーブルへ載せ、API の
 * sources[].notes として根拠カードに表示されるため対象に含める(実際、手続きデータを直しただけでは
 * 中野区の根拠カードに「品川区」が残っていた)。
 * 一方 facilities.json のファイル階層メタデータ(note / extractionNote / dataQualityNotes)は
 * publish が読まない取得手法の来歴記録で、「どの区の抽出方法を前例にしたか」を残すことに意味が
 * あるため対象外とする(facilities[] 本体は対象)。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/**
 * 東京23特別区の名称。出典は scripts/publish/src/municipalities.ts(東京都公式「都内区市町村」
 * リンク集を根拠に人手レビュー済みのマスタ)。ここは packages/rules から scripts を import できない
 * ため転記する。特別区の名称は法定で、追加・改称があれば municipalities.ts 側と同時に更新する。
 */
const WARD_NAMES: Readonly<Record<string, string>> = {
  '13101': '千代田区',
  '13102': '中央区',
  '13103': '港区',
  '13104': '新宿区',
  '13105': '文京区',
  '13106': '台東区',
  '13107': '墨田区',
  '13108': '江東区',
  '13109': '品川区',
  '13110': '目黒区',
  '13111': '大田区',
  '13112': '世田谷区',
  '13113': '渋谷区',
  '13114': '中野区',
  '13115': '杉並区',
  '13116': '豊島区',
  '13117': '北区',
  '13118': '荒川区',
  '13119': '板橋区',
  '13120': '練馬区',
  '13121': '足立区',
  '13122': '葛飾区',
  '13123': '江戸川区',
};

/**
 * 例外(誤検知ではなく「その区自身の公式ページが他区名を明記している」ケース)。
 * textIncludes で該当の一文をピン留めするため、同じ区・同じ他区名でも別の文言が混入すれば落ちる。
 * 追加するときは必ず reason に「なぜその区の情報と言えるのか」を書くこと。黙って緩めない。
 */
interface AllowedMention {
  readonly municipalityCode: string;
  readonly wardName: string;
  readonly textIncludes: string;
  readonly reason: string;
}

const ALLOWLIST: readonly AllowedMention[] = [
  {
    municipalityCode: '13119',
    wardName: '練馬区',
    textIncludes: '転入予定のない練馬区民は申込みを制限されません',
    reason:
      '板橋区公式の保育施設申込みページ(src-13119-childcare-001)の注意事項が、板橋区自身の取扱いとして' +
      '「転入予定のない練馬区民も申込みを制限しません」と明記している。練馬区の情報の持ち込みではなく' +
      '板橋区のルールそのもので、区名を外すと板橋区へ申し込む練馬区民が自分の扱いを判断できなくなる。',
  },
  {
    municipalityCode: '13119',
    wardName: '練馬区',
    textIncludes: '転入予定のない練馬区民は申込み制限の対象外',
    reason:
      '上と同じ板橋区公式ページの記載を registry.csv の notes(根拠カードに表示)へ要約したもの。' +
      '板橋区自身のルールであり、区名を外すと対象者が自分の扱いを判断できなくなる。',
  },
];

/** 検査対象ファイル。scope は「そのファイルのどの部分を見るか」。 */
interface Target {
  readonly label: string;
  /** リポジトリルートからの相対パス。{code} は自治体コードへ置換する。 */
  readonly path: string;
  /** ファイル全体ではなく一部だけを見る場合の絞り込み。 */
  readonly pick?: (json: Record<string, unknown>) => unknown;
}

const TARGETS: readonly Target[] = [
  { label: '手続き(公開)', path: 'data/normalized/{code}/procedures.json' },
  { label: 'ルール定義', path: 'packages/rules/data/{code}/rules.json' },
  {
    label: '窓口施設(公開分のみ)',
    path: 'data/normalized/{code}/facilities.json',
    pick: (json) => json.facilities,
  },
  { label: 'ごみ収集日', path: 'data/normalized/{code}/waste.json' },
  { label: 'ごみ分別辞書', path: 'data/normalized/{code}/waste-sorting.json' },
];

/** data/normalized 配下に縦切りデータがある区(区が増えても自動で検査対象に入る)。 */
const WARDS: readonly string[] = readdirSync(resolve(repoRoot, 'data/normalized'))
  .filter((name) => /^\d{5}$/.test(name))
  .sort();

interface Finding {
  readonly municipalityCode: string;
  readonly label: string;
  readonly jsonPath: string;
  readonly wardName: string;
  readonly text: string;
}

function isAllowed(f: Finding): boolean {
  return ALLOWLIST.some(
    (a) =>
      a.municipalityCode === f.municipalityCode &&
      a.wardName === f.wardName &&
      f.text.includes(a.textIncludes),
  );
}

/** 任意のJSON値を再帰的に走査し、他区名を含む文字列を収集する。 */
function collect(
  node: unknown,
  jsonPath: string,
  self: string,
  label: string,
  out: Finding[],
): void {
  if (typeof node === 'string') {
    for (const [code, wardName] of Object.entries(WARD_NAMES)) {
      if (code === self) continue; // 自区の名称は当然許可する
      if (node.includes(wardName)) {
        out.push({ municipalityCode: self, label, jsonPath, wardName, text: node });
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, `${jsonPath}[${i}]`, self, label, out));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collect(v, `${jsonPath}.${k}`, self, label, out);
  }
}

function dataFindingsFor(code: string): Finding[] {
  const out: Finding[] = [];
  for (const target of TARGETS) {
    const file = resolve(repoRoot, target.path.replace('{code}', code));
    if (!existsSync(file)) continue; // 誠実縮退でデータを作らない区がある(ごみ収集日など)
    const json = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    collect(target.pick ? target.pick(json) : json, '', code, target.label, out);
  }
  return out;
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

/**
 * source registry のうち公開される列を検査する。
 * municipality_code が区でない行(13000=東京都 / 00000=国)は全区のチェックリストに出るため、
 * どの区名が出ても混入として扱う(self に一致しないので自然にそうなる)。
 */
function registryFindings(): Finding[] {
  const rows = parseCsv(readFileSync(resolve(repoRoot, 'docs/data-sources/registry.csv'), 'utf-8'));
  const header = rows[0] ?? [];
  const idIdx = header.indexOf('source_id');
  const codeIdx = header.indexOf('municipality_code');
  const publicCols = ['source_title', 'attribution_text', 'notes'].map((c) => header.indexOf(c));
  const out: Finding[] = [];
  for (const row of rows.slice(1)) {
    const sourceId = row[idIdx];
    if (!sourceId) continue;
    const code = row[codeIdx] ?? '';
    for (const col of publicCols) {
      collect(row[col] ?? '', `${sourceId}.${header[col]}`, code, '出典台帳(公開列)', out);
    }
  }
  return out;
}

/** 落ちたときに「どの区のどのフィールドに、どの区名が入っているか」が分かるメッセージ。 */
function describeFindings(findings: readonly Finding[]): string {
  return findings
    .map(
      (f) =>
        `\n  [${f.municipalityCode} ${WARD_NAMES[f.municipalityCode] ?? '?'}] ${f.label} ` +
        `${f.jsonPath}\n    他区名「${f.wardName}」が混入: ${f.text}`,
    )
    .join('\n');
}

describe('原則4 — 各区の公開データに他区の名称を混ぜない(全区総当たり)', () => {
  it('検査対象の区が存在し、23特別区の名称マスタが揃っている', () => {
    expect(WARDS.length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(WARD_NAMES)).toHaveLength(23);
    // 対応済みの区は必ず 131xx(特別区)であり、名称マスタに存在する。
    for (const code of WARDS) expect(WARD_NAMES[code], code).toBeDefined();
  });

  it.each(WARDS)('%s: 手続き・ルール・施設・ごみ・出典台帳に他22区の名称が現れない', (code) => {
    const findings = [
      ...dataFindingsFor(code),
      ...registryFindings().filter((f) => f.municipalityCode === code),
    ].filter((f) => !isAllowed(f));
    expect(findings, describeFindings(findings)).toEqual([]);
  });

  it('出典台帳(registry.csv)の公開列は、区に紐づかない行も含めて他区名を含まない', () => {
    // なぜ: 13000(東京都)・00000(国)の出典は全区のチェックリストに出るため、
    // どの区名が混じっても「選択した区と違う自治体の情報」になる。区別ループでは拾えないので独立させる。
    const findings = registryFindings().filter((f) => !isAllowed(f));
    expect(findings, describeFindings(findings)).toEqual([]);
  });

  it('全区を合わせても、許可した例外以外に他区名の混入がない', () => {
    // なぜ: it.each は区ごとに落ちるが、総数0であること自体を1本の不変条件として残す。
    const all = [...WARDS.flatMap(dataFindingsFor), ...registryFindings()].filter(
      (f) => !isAllowed(f),
    );
    expect(all, describeFindings(all)).toHaveLength(0);
  });

  it('検出ロジックが実際に他区名を捕まえる(テスト自体の有効性)', () => {
    // なぜ: 「常に空配列を返すだけのテスト」に劣化していないことを保証する。
    // 千代田区のデータに新宿区の期限値が書かれていた実際の違反文言を模した文字列を流す。
    const out: Finding[] = [];
    collect(
      { procedures: [{ cautions: ['期限は90日以内です(新宿区の14日以内とは相違)。'] }] },
      '',
      '13101',
      'テスト',
      out,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.wardName).toBe('新宿区');
    expect(out[0]?.jsonPath).toBe('.procedures[0].cautions[0]');

    // 自区の名称、および区名の短縮形を含む施設名・地名は検出しない(誤検知しない)。
    const noise: Finding[] = [];
    collect(
      [
        '千代田区の窓口で受け付けます。',
        '運転免許試験場(府中・鮫洲・江東)',
        '運転免許更新センター(神田・新宿)',
        '東中野',
        '北庁舎1階1番窓口',
      ],
      '',
      '13101',
      'テスト',
      noise,
    );
    expect(noise).toEqual([]);
  });

  it('allowlist の各エントリは実際に使われている(不要な緩和を残さない)', () => {
    const all = [...WARDS.flatMap(dataFindingsFor), ...registryFindings()];
    for (const entry of ALLOWLIST) {
      const used = all.some(
        (f) =>
          f.municipalityCode === entry.municipalityCode &&
          f.wardName === entry.wardName &&
          f.text.includes(entry.textIncludes),
      );
      expect(used, `未使用の allowlist: ${entry.municipalityCode} / ${entry.wardName}`).toBe(true);
      // 理由を書かない緩和を許さない。
      expect(entry.reason.length).toBeGreaterThan(30);
    }
  });
});
