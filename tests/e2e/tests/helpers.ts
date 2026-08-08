import type { Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * なぜ: 全スペックで使う自治体選択・ウィザード入力・チャットのモック手順を1か所に集約する。
 * data-testid は本アプリに無い方針(§15.3のセマンティックHTML優先)のため、role/label/textで
 * 要素を特定する。これはスクリーンリーダーが辿る導線と同じで、a11yの担保も兼ねる。
 */

export const WARDS = {
  setagaya: { code: '13112', name: '世田谷区' },
  koto: { code: '13108', name: '江東区' },
  shinjuku: { code: '13104', name: '新宿区' },
  suginami: { code: '13115', name: '杉並区' },
} as const;

/** ランディングで対応自治体カードの「この自治体で始める」を押してウィザードへ。 */
export async function startWithWard(page: Page, wardName: string): Promise<void> {
  const card = page.getByRole('listitem').filter({ hasText: wardName });
  await card.getByRole('button', { name: /この自治体で始める/ }).click();
  await expect(page).toHaveURL(/\/wizard$/);
}

interface Step1 {
  moveDate: string; // YYYY-MM-DD
  origin?: '東京都外' | '東京都内の別自治体' | '海外';
}

/** ウィザードStep1(必須)を入力する。 */
export async function fillWizardStep1(page: Page, s: Step1): Promise<void> {
  await page.getByLabel(/引越し日または転入予定日/).fill(s.moveDate);
  await page.getByRole('radio', { name: s.origin ?? '東京都外' }).check();
}

/** ウィザード下部の生成ボタンを押し、チェックリストへ遷移する。 */
export async function generateChecklist(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'この内容でチェックリストを作成' }).click();
  await expect(page).toHaveURL(/\/checklist$/);
  // 生成完了(進捗ステータス)を待つ。
  await expect(page.getByText(/件 完了/)).toBeVisible();
}

/** Step2の年齢帯チェックボックスをトグルする(子育て条件の追加/削除に使用)。 */
export async function toggleAgeBand(page: Page, label: string, checked: boolean): Promise<void> {
  const box = page.getByRole('checkbox', { name: label });
  if (checked) await box.check();
  else await box.uncheck();
}

const CITATION = {
  sourceId: 'src-13112-resident_registration-001',
  title: '世田谷区 転入届(区外から世田谷区に引越しをしてきたときの届出)',
  ownerOrganization: '世田谷区',
  url: 'https://www.city.setagaya.lg.jp/02233/88.html',
  lastVerifiedAt: '2026-07-21T00:00:00Z',
};

/**
 * /api/chat を決定論的にモックする(実OpenAI/Vectorizeを叩かない)。
 * availability も併せて上書きし、RAG_ENABLED等の実サーバ状態に依存しないようにする。
 */
export async function mockChat(
  page: Page,
  kind: 'normal' | 'abstained' | 'disabled',
): Promise<void> {
  await page.route('**/api/chat/availability', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: kind !== 'disabled' }),
    }),
  );

  if (kind === 'disabled') return;

  await page.route('**/api/chat', (route: Route) => {
    if (kind === 'abstained') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer:
            'ご質問の内容については、確認できませんでした（公式の根拠が見つかりませんでした）。お手数ですが、各自治体の公式ページで最新情報をご確認ください。',
          citations: [],
          confidence: 'unknown',
          abstained: true,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: '転入届には本人確認書類などが必要です。詳細は公式ページでご確認ください。',
        citations: [CITATION],
        confidence: 'high',
        abstained: false,
      }),
    });
  });
}

/** アクセシビリティ検証などで、UI操作を経ずにプロフィールをlocalStorageへ用意する。 */
export async function seedProfile(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    localStorage.setItem('tmn:municipality', c);
    localStorage.setItem(
      `tmn:profile:${c}`,
      JSON.stringify({
        destination: { municipalityCode: c },
        moveDate: '2026-08-15',
        originType: 'outside_tokyo',
        household: { memberCount: 2, ageBands: ['adult', 'age0_2'] },
        flags: {
          hasMyNumberCard: true,
          needsNationalHealthInsurance: true,
          needsNationalPension: true,
          hasSchoolOrChildcareNeeds: true,
          hasDog: true,
          dogHasMicrochip: 'unknown',
          needsDisabilityOrCareSupport: false,
          needsForeignResidentGuidance: false,
          needsVehicleGuidance: false,
          isPregnantMember: false,
        },
      }),
    );
  }, code);
}

/**
 * 24px×24px 未満のインタラクティブ要素(WCAG 2.2 SC 2.5.8 ターゲットのサイズ・最小)。
 *
 * なぜ実測か: axe-core は SC 2.5.8 を自動判定しない(サイズはレイアウト結果に依存する)。
 * ブラウザ上で getBoundingClientRect の実寸を数えるのが唯一の確実な検出方法。
 *
 * 判定の約束事:
 *  - 画面に出ていない要素(display:none / 1px以下のスキップリンク等)は対象外。
 *  - <label> に包まれた入力(チェックボックス・ラジオ)は、ラベル全体が押せる連続した標的なので
 *    ラベルの寸法で評価する。
 *  - SC 2.5.8 の例外(文中リンク・間隔)には頼らず、24pxを実寸で満たす方針にする。
 *    例外に頼ると「この標的は文中だから小さくてよい」の判断がテストから消え、
 *    実際には押しにくい標的を見逃すため。
 */
export interface SmallTarget {
  width: number;
  height: number;
  tag: string;
  name: string;
  className: string;
}

export async function findSmallTargets(page: Page): Promise<SmallTarget[]> {
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
  return page.evaluate(() => {
    const SELECTOR = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    const out: SmallTarget[] = [];
    for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const own = el.getBoundingClientRect();
      // 1px以下は「フォーカス時だけ実体化する」スキップリンク等。押す標的ではない。
      if (own.width <= 1 && own.height <= 1) continue;

      let width = own.width;
      let height = own.height;
      const label = el.closest('label');
      if (label && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
        const rect = label.getBoundingClientRect();
        width = Math.max(width, rect.width);
        height = Math.max(height, rect.height);
      }
      if (width >= 24 && height >= 24) continue;

      out.push({
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') ?? el.textContent ?? el.id ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40),
        className: (el.getAttribute('class') ?? '').slice(0, 60),
      });
    }
    return out;
  });
}

/** 失敗メッセージ用の整形(件数と実寸が一目で分かるようにする)。 */
export function formatSmallTargets(screen: string, targets: SmallTarget[]): string {
  if (targets.length === 0) return `${screen}: 24px未満の標的なし`;
  return [
    `${screen}: 24px未満の標的が ${targets.length} 件`,
    ...targets
      .slice(0, 15)
      .map((t) => `  ${t.width}x${t.height} <${t.tag}> "${t.name}" class="${t.className}"`),
  ].join('\n');
}

/** 現在のフォーカス要素の識別情報を返す(キーボード操作スモーク用)。 */
export async function activeElementInfo(
  page: Page,
): Promise<{ tag: string; id: string; text: string; type: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? '',
      id: el?.id ?? '',
      text: (el?.textContent ?? '').trim().slice(0, 40),
      type: (el as HTMLInputElement | null)?.type ?? '',
    };
  });
}

/** predicate が真になるまで Tab を押す(最大 max 回)。到達時の押下回数を返す。 */
export async function tabUntil(
  page: Page,
  predicate: (info: Awaited<ReturnType<typeof activeElementInfo>>) => boolean,
  max = 40,
): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    const info = await activeElementInfo(page);
    if (predicate(info)) return i;
  }
  throw new Error(`tabUntil: predicate not satisfied within ${max} Tab presses`);
}
