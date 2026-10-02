import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasSourceSnapshots } from '@tmn/test-fixtures/source-snapshots';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnMunicipality,
  loadFacilitiesFor,
  loadProceduresFor,
  loadRuleSetFor,
  loadSources,
  loadWasteFor,
  loadWasteSortingFor,
} from './load.js';
import { buildSeedStatements } from './sql.js';
import { SnapshotIntegrityError } from './snapshot-files.js';
import { DEFAULT_PUBLISH_CODES, loadPublishData } from './load.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * なぜ: ADR-014 の巡回は「承認時スナップショットから同じ抽出器で得た更新日」を基準にする。
 * publish がその基準値を台帳の行に載せること(あるもの・無いものの両方)を実データで固定する。
 */
describe('loadSources — snapshotPageUpdatedOn(ADR-014 の比較基準)', () => {
  const sources = loadSources(repoRoot);
  const byId = new Map(sources.map((s) => [s.sourceId, s]));

  // 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
  it.skipIf(!hasSourceSnapshots())(
    '渋谷区(ラベルと日付の間にタグが挟まる形式)の更新日を抽出する',
    () => {
      // 再監査のたびに版付きスナップショットが現行版になる(2026-09-25 は更新日 2026-09-17、
      // 2026-10-03 は 2026-10-01)。形式(ラベルと日付の間にタグ)は承認時と同じで、
      // 現行版から抽出できることを確かめる。
      expect(byId.get('src-13113-resident_registration-001')?.snapshotPageUpdatedOn).toBe(
        '2026-10-01',
      );
    },
  );

  it('更新日表記の無いページ(中央区)は undefined(推測で埋めない)', () => {
    const s = byId.get('src-13102-resident_registration-001');
    expect(s).toBeDefined();
    expect(s?.snapshotPageUpdatedOn).toBeUndefined();
  });

  it('csv/xlsx ソースには付けない(生ハッシュで比較する種別)', () => {
    for (const s of sources) {
      if (s.sourceType === 'csv' || s.sourceType === 'xlsx') {
        expect(s.snapshotPageUpdatedOn, s.sourceId).toBeUndefined();
      }
    }
  });

  // 原文スナップショット(著作権の都合で公開リポジトリには含めない)が無いときだけ skip する。
  it.skipIf(!hasSourceSnapshots())(
    '承認済み HTML ソースの大半(250件以上)で更新日が得られる',
    () => {
      const approvedHtml = sources.filter(
        (s) => s.reviewStatus === 'approved' && s.sourceType === 'html',
      );
      const withDate = approvedHtml.filter((s) => s.snapshotPageUpdatedOn !== undefined);
      expect(withDate.length).toBeGreaterThanOrEqual(250);
    },
  );

  it('seed SQL の sources INSERT に snapshot_page_updated_on 列が含まれる', () => {
    const data = loadPublishData(repoRoot, DEFAULT_PUBLISH_CODES);
    const insert = buildSeedStatements(data).find((s) => s.startsWith('INSERT INTO sources ('));
    expect(insert).toContain('snapshot_page_updated_on');
  });
});

/**
 * なぜ: publish は原文スナップショットから巡回の基準日(snapshot_page_updated_on)を作り、台帳の
 * content_hash と一緒に D1 へ載せる。原文が承認後に差し替わっていたら、その値は承認した原文の
 * ものではない。読むたびに SHA-256 を照合して食い違えば止まることを、一時ディレクトリの
 * 最小台帳で固定する(実データは触らない)。
 */
describe('loadSources — スナップショットの改ざん検査(fail closed)', () => {
  const HEADER =
    'source_id,source_title,owner_organization,municipality_code,category,source_url,source_type,' +
    'license,attribution_text,fetch_method,update_frequency,last_fetched_at,last_verified_at,' +
    'source_last_modified_at,content_hash,effective_from,effective_to,review_status,reviewer,notes';
  const ID = 'src-13112-resident_registration-001';
  const APPROVED_HTML = '<html><body><p>更新日：2026年9月17日</p><p>転入届</p></body></html>';
  let root: string;

  function setup(snapshotBody: string, recordedHash: string): void {
    mkdirSync(resolve(root, 'docs/data-sources'), { recursive: true });
    writeFileSync(
      resolve(root, 'docs/data-sources/registry.csv'),
      `${HEADER}\n${ID},転入届,世田谷区,13112,resident_registration,` +
        `https://www.city.setagaya.lg.jp/x.html,html,規約,世田谷区,http_get,as_needed,` +
        `2026-09-25,2026-09-25,,${recordedHash},,,approved,rev,\n`,
    );
    const dir = resolve(root, 'data/sources/13112/snapshots');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${ID}.html`), snapshotBody);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tmn-load-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('正常系: ハッシュが一致すれば読み、基準日を抽出する', () => {
    setup(APPROVED_HTML, createHash('sha256').update(APPROVED_HTML).digest('hex'));
    const [s] = loadSources(root);
    expect(s?.snapshotPageUpdatedOn).toBe('2026-09-17');
  });

  it('攻撃系: 承認後に原文が差し替わっていれば publish を止める', () => {
    const approvedHash = createHash('sha256').update(APPROVED_HTML).digest('hex');
    setup(APPROVED_HTML.replace('2026年9月17日', '2030年1月1日'), approvedHash);
    expect(() => loadSources(root)).toThrow(SnapshotIntegrityError);
  });

  it('攻撃系: csv の原文も照合する(台帳の content_hash を公開するため)', () => {
    setup(APPROVED_HTML, createHash('sha256').update(APPROVED_HTML).digest('hex'));
    const csvId = 'src-13112-facilities-001';
    writeFileSync(
      resolve(root, 'docs/data-sources/registry.csv'),
      `${HEADER}\n${csvId},施設,世田谷区,13112,facilities,https://www.city.setagaya.lg.jp/f.csv,csv,` +
        `CC BY 4.0,世田谷区,http_get,annual,2026-09-25,2026-09-25,,${'0'.repeat(64)},,,approved,rev,\n`,
    );
    writeFileSync(resolve(root, 'data/sources/13112/snapshots', `${csvId}.csv`), 'a,b\n1,2\n');
    expect(() => loadSources(root)).toThrow(SnapshotIntegrityError);
  });

  it('スナップショットが無い環境(公開リポジトリ)では従来どおり基準日なしで読む', () => {
    setup(APPROVED_HTML, 'f'.repeat(64));
    rmSync(resolve(root, 'data/sources'), { recursive: true, force: true });
    const [s] = loadSources(root);
    expect(s?.snapshotPageUpdatedOn).toBeUndefined();
  });
});

/**
 * なぜ: ゲートの自治体混在検査(原則4)は「読み込んだディレクトリの自治体コード」を公開物の自治体と
 * みなす。ファイルの中身が別の自治体を名乗っていると、その検査の前提が崩れるので読み込みで止める。
 */
describe('assertOwnMunicipality — ファイルの中身が自分の自治体を名乗っているか', () => {
  const code = '13112';
  const procs = loadProceduresFor(repoRoot, code);
  const rules = loadRuleSetFor(repoRoot, code);
  const facs = loadFacilitiesFor(repoRoot, code);
  const waste = loadWasteFor(repoRoot, code).dataset;
  const sorting = loadWasteSortingFor(repoRoot, code);

  it('正常系: 実データ(世田谷)は通る', () => {
    expect(() => assertOwnMunicipality(code, procs, rules, facs, waste, sorting)).not.toThrow();
  });

  it('攻撃系: 世田谷のファイルに江東を名乗る手続きが混ざっていたら止める', () => {
    const mixed = [...procs, { ...procs[0]!, municipalityCode: '13108' }];
    expect(() => assertOwnMunicipality(code, mixed, rules, facs, waste, sorting)).toThrow(/13108/);
  });

  it('攻撃系: 施設・分別辞書・ルールセットでも同じ', () => {
    const otherRules = { ...rules, municipalityCode: '13108' };
    const otherFacs = [{ ...facs[0]!, municipalityCode: '13108' }];
    const otherSorting = [{ ...sorting[0]!, municipalityCode: '13108' }];
    expect(() => assertOwnMunicipality(code, procs, otherRules, facs, waste, sorting)).toThrow();
    expect(() => assertOwnMunicipality(code, procs, rules, otherFacs, waste, sorting)).toThrow();
    expect(() => assertOwnMunicipality(code, procs, rules, facs, waste, otherSorting)).toThrow();
  });
});
