import { describe, expect, it } from 'vitest';
import {
  assertOfficialUrl,
  DisallowedHostError,
  FetchPolicyError,
  fetchOfficial,
  isOfficialHost,
  MAX_BODY_BYTES,
  MAX_REDIRECT_HOPS,
} from './http.js';

describe('isOfficialHost — official-domain allowlist', () => {
  it('allows municipal and Tokyo open-data hosts under .lg.jp', () => {
    expect(isOfficialHost('www.city.setagaya.lg.jp')).toBe(true);
    expect(isOfficialHost('www.city.shinjuku.lg.jp')).toBe(true);
    expect(isOfficialHost('opendata.metro.tokyo.lg.jp')).toBe(true);
    expect(isOfficialHost('catalog.data.metro.tokyo.lg.jp')).toBe(true);
  });

  it('rejects non-official hosts', () => {
    expect(isOfficialHost('example.com')).toBe(false);
    expect(isOfficialHost('evil-lg.jp.attacker.com')).toBe(false);
    expect(isOfficialHost('notlg.jp')).toBe(false); // suffix ".lg.jp" は "notlg.jp" に一致しない
  });
});

describe('assertOfficialUrl', () => {
  it('accepts https official urls', () => {
    expect(() => assertOfficialUrl('https://www.city.setagaya.lg.jp/x.html')).not.toThrow();
  });
  it('rejects http (non-https)', () => {
    expect(() => assertOfficialUrl('http://www.city.setagaya.lg.jp/x.html')).toThrow(
      DisallowedHostError,
    );
  });
  it('rejects non-official host', () => {
    expect(() => assertOfficialUrl('https://example.com/x')).toThrow(DisallowedHostError);
  });
});

describe('許可ホストの拡張(2026-08-07)', () => {
  it('国の機関(.go.jp)を許可する', () => {
    expect(isOfficialHost('www.digital.go.jp')).toBe(true);
  });

  it('公式サイトが .tokyo.jp の区を完全一致で許可する', () => {
    for (const h of [
      'www.city.suginami.tokyo.jp',
      'www.city.shinagawa.tokyo.jp',
      'www.city.ota.tokyo.jp',
      'www.city.nerima.tokyo.jp',
      'www.city.itabashi.tokyo.jp',
      // Batch10(足立区13121 / 江戸川区13123)。いずれも当該区の公式サイトであることを監査で確認済み。
      'www.city.adachi.tokyo.jp',
      'www.city.edogawa.tokyo.jp',
      'www.city.meguro.tokyo.jp',
      'www.city.shibuya.tokyo.jp',
    ]) {
      expect(isOfficialHost(h)).toBe(true);
    }
  });

  /**
   * なぜ: 渋谷区の実質的なオープンデータ(122件・公共施設CSV 527行)は Esri ArcGIS Hub 上の
   * 区公式ドメイン外ホストで配信されている。中野区の wagmap.jp と同種の論点であり
   * ユーザー決裁を要したが、2026-08-07 に「今許可する」との決裁を得て許可リストへ
   * 完全一致で追加した(docs/research/opendata-gaps.md 事例15)。
   *
   * ここで固定するのは「決裁されたのは渋谷区のこの1ホストだけ」という範囲。
   * arcgis.com は世界中の誰でもHubサイトを作れる汎用SaaSドメインなので、
   * 接尾辞許可や兄弟ホストへ広がっていないことを負例で押さえる。
   */
  it('渋谷区のArcGIS Hub配信ホストはユーザー決裁(2026-08-07)により許可する', () => {
    expect(isOfficialHost('city-shibuya-data.opendata.arcgis.com')).toBe(true);
  });

  it('決裁の範囲は渋谷区の当該ホストのみで、arcgis.com の他ホストへは広げない', () => {
    expect(isOfficialHost('opendata.arcgis.com')).toBe(false);
    expect(isOfficialHost('arcgis.com')).toBe(false);
    expect(isOfficialHost('evil.opendata.arcgis.com')).toBe(false);
    // 接尾辞一致で通ってしまう実装退行(endsWith 化)を捕まえる負例。
    expect(isOfficialHost('evil-city-shibuya-data.opendata.arcgis.com')).toBe(false);
    expect(isOfficialHost('city-shibuya-data.opendata.arcgis.com.evil.com')).toBe(false);
  });

  it('日本郵便と中野区のデータ配信先を許可する', () => {
    expect(isOfficialHost('www.post.japanpost.jp')).toBe(true);
    expect(isOfficialHost('www2.wagmap.jp')).toBe(true);
  });

  // なぜ: .tokyo.jp は都内に住所があれば誰でも取れる地域ドメインで、公式性の証明にならない。
  // 接尾辞ではなく完全一致で許可している不変条件を固定する。
  it('未登録の .tokyo.jp と wagmap のサブドメインは拒否する', () => {
    expect(isOfficialHost('evil.tokyo.jp')).toBe(false);
    expect(isOfficialHost('www.city.fake.tokyo.jp')).toBe(false);
    expect(isOfficialHost('evil.wagmap.jp')).toBe(false);
    expect(isOfficialHost('www2.wagmap.jp.evil.com')).toBe(false);
  });
});

/**
 * なぜ: 再取得(ingest / reaudit)は持ち主の Mac から公式ページへ要求を送る。自動追従
 * (redirect: 'follow')だと、公式ページの 30x 一つで非公式ホスト・LAN・localhost・http へも
 * 要求が飛び、その本文がスナップショット候補になってしまう。巡回(apps/api/src/drift.ts)と
 * 同じ方針(手動追従・各ホップで公式ホストを再検査・ホップ上限・https→http の拒否・
 * 総時間の制限・読みながら数えるバイト上限)を固定する。ネットワークには出ない(fetch は偽物)。
 */
describe('fetchOfficial — redirect / size policy (SSRF hardening)', () => {
  const OFFICIAL = 'https://www.city.setagaya.lg.jp/a.html';

  interface Call {
    url: string;
    init: RequestInit | undefined;
  }

  /** URL → 応答 の表で振る舞う偽 fetch。呼ばれた URL と init を記録する。 */
  function fakeFetch(routes: Record<string, () => Response>): {
    fetchImpl: typeof fetch;
    calls: Call[];
  } {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      const route = routes[url];
      if (!route) throw new Error(`unexpected request to ${url}`);
      return route();
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  const redirect =
    (location: string, status = 302) =>
    () =>
      new Response(null, { status, headers: { location } });
  const ok =
    (body: string | Uint8Array, headers: Record<string, string> = {}) =>
    () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } });

  it('正常系: 公式ホスト内の転送を手動で辿り、最終URLと本文を返す', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [OFFICIAL]: redirect('/b.html', 301),
      'https://www.city.setagaya.lg.jp/b.html': ok('<p>本文</p>'),
    });
    const res = await fetchOfficial(OFFICIAL, { fetchImpl, retries: 0 });
    expect(new TextDecoder().decode(res.bytes)).toBe('<p>本文</p>');
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe('https://www.city.setagaya.lg.jp/b.html');
    expect(calls.map((c) => c.url)).toEqual([OFFICIAL, 'https://www.city.setagaya.lg.jp/b.html']);
    // 自動追従させない(各ホップをこちらで検査するため)。
    for (const c of calls) expect(c.init?.redirect).toBe('manual');
  });

  it.each([
    ['非公式ホスト', 'https://evil.example.com/x'],
    ['localhost', 'https://localhost/admin'],
    ['loopback IP', 'https://127.0.0.1/'],
    ['LAN の IP', 'https://192.168.1.1/'],
    ['メタデータ IP', 'http://169.254.169.254/latest/meta-data/'],
    ['公式ホストへの http ダウングレード', 'http://www.city.setagaya.lg.jp/b.html'],
    ['公式ホストの別ポート', 'https://www.city.setagaya.lg.jp:8443/b.html'],
    ['userinfo 付き', 'https://user:pass@www.city.setagaya.lg.jp/b.html'],
    ['file スキーム', 'file:///etc/passwd'],
    ['公式ホストに見せかけた接尾辞', 'https://www.city.setagaya.lg.jp.evil.com/'],
  ])('攻撃系: %s への転送はその先へ要求を送らずに拒否する', async (_label, location) => {
    const { fetchImpl, calls } = fakeFetch({ [OFFICIAL]: redirect(location) });
    await expect(fetchOfficial(OFFICIAL, { fetchImpl, retries: 0 })).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
    expect(calls.map((c) => c.url)).toEqual([OFFICIAL]);
  });

  it('攻撃系: 転送が上限(4ホップ)を超えたら拒否する', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) {
      routes[`https://www.city.setagaya.lg.jp/${i}.html`] = redirect(`/${i + 1}.html`);
    }
    const { fetchImpl, calls } = fakeFetch(routes);
    await expect(
      fetchOfficial('https://www.city.setagaya.lg.jp/0.html', { fetchImpl, retries: 0 }),
    ).rejects.toMatchObject({ reason: 'too_many_redirects' });
    // 最初の要求 + 4回の転送 = 5回。5回目の転送先へは送らない。
    expect(calls).toHaveLength(MAX_REDIRECT_HOPS + 1);
  });

  it('正常系: 上限ちょうど(4ホップ)の転送は辿る', async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 4; i++) {
      routes[`https://www.city.setagaya.lg.jp/${i}.html`] = redirect(`/${i + 1}.html`);
    }
    routes['https://www.city.setagaya.lg.jp/4.html'] = ok('done');
    const { fetchImpl } = fakeFetch(routes);
    const res = await fetchOfficial('https://www.city.setagaya.lg.jp/0.html', {
      fetchImpl,
      retries: 0,
    });
    expect(new TextDecoder().decode(res.bytes)).toBe('done');
  });

  it('攻撃系: Location の無い 30x は拒否する(推測で先へ進まない)', async () => {
    const { fetchImpl } = fakeFetch({ [OFFICIAL]: () => new Response(null, { status: 302 }) });
    await expect(fetchOfficial(OFFICIAL, { fetchImpl, retries: 0 })).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
  });

  it('攻撃系: 申告サイズ(Content-Length)が上限を超えたら本文を読まずに拒否する', async () => {
    const { fetchImpl } = fakeFetch({
      [OFFICIAL]: ok('x', { 'content-length': String(MAX_BODY_BYTES + 1) }),
    });
    await expect(fetchOfficial(OFFICIAL, { fetchImpl, retries: 0 })).rejects.toMatchObject({
      reason: 'body_too_large',
    });
  });

  it('攻撃系: 申告が無く実際の本文が上限を超えたら、読むのをやめて拒否する', async () => {
    let sent = 0;
    const { fetchImpl } = fakeFetch({
      [OFFICIAL]: () => {
        // 1KB ずつ流し続けるストリーム(Content-Length 無し)。上限で読むのをやめるかを見る。
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= 1024 * 1024) {
              controller.close();
              return;
            }
            sent += 1024;
            controller.enqueue(new Uint8Array(1024));
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    await expect(
      fetchOfficial(OFFICIAL, { fetchImpl, retries: 0, maxBytes: 16 * 1024 }),
    ).rejects.toMatchObject({ reason: 'body_too_large' });
    // 最後まで読み切っていない(上限の少し先で打ち切った)。
    expect(sent).toBeLessThan(1024 * 1024);
  });

  it('正常系: 上限ちょうどの本文は受け入れる', async () => {
    const body = new Uint8Array(16 * 1024);
    const { fetchImpl } = fakeFetch({ [OFFICIAL]: ok(body) });
    const res = await fetchOfficial(OFFICIAL, { fetchImpl, retries: 0, maxBytes: 16 * 1024 });
    expect(res.bytes.byteLength).toBe(16 * 1024);
  });

  it('方針違反は再試行しない(同じ結果になるだけで、相手に要求を重ねない)', async () => {
    const { fetchImpl, calls } = fakeFetch({ [OFFICIAL]: redirect('https://evil.example.com/') });
    await expect(fetchOfficial(OFFICIAL, { fetchImpl, retries: 3 })).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
    expect(calls).toHaveLength(1);
  });

  it('一過性のネットワーク失敗は retries 回だけ再試行する(従来どおり)', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const res = await fetchOfficial(OFFICIAL, { fetchImpl, retries: 1 });
    expect(new TextDecoder().decode(res.bytes)).toBe('ok');
    expect(n).toBe(2);
  });

  it('非 2xx は例外(呼び出し側で fetch_error に分類)', async () => {
    const { fetchImpl } = fakeFetch({ [OFFICIAL]: () => new Response('nf', { status: 404 }) });
    await expect(fetchOfficial(OFFICIAL, { fetchImpl, retries: 0 })).rejects.toThrow(/HTTP 404/);
  });

  it('総時間の制限: 応答が来なければ timeoutMs で打ち切る', async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    await expect(
      fetchOfficial(OFFICIAL, { fetchImpl, retries: 0, timeoutMs: 20 }),
    ).rejects.toThrow();
  });

  it('最初の URL も同じ方針で検査する(userinfo・別ポートを拒否)', async () => {
    const { fetchImpl, calls } = fakeFetch({});
    for (const url of [
      'https://user@www.city.setagaya.lg.jp/a.html',
      'https://www.city.setagaya.lg.jp:8080/a.html',
    ]) {
      await expect(fetchOfficial(url, { fetchImpl, retries: 0 })).rejects.toBeInstanceOf(
        DisallowedHostError,
      );
    }
    expect(calls).toHaveLength(0);
  });
});
