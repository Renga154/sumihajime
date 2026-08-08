import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
// なぜ: maplibre-gl v6 はワーカーURLを実行時に `new URL('./maplibre-gl-worker.mjs',
// import.meta.url)` で組み立てる。Vite はこの動的な参照を追えないためワーカーを出力せず、
// バンドル後は存在しない /assets/maplibre-gl-worker.mjs を指してSPAのHTMLを掴む
// (=タイルのデコードが無言で死に、マーカーだけが無地の上に浮く)。Vite の ?worker&url で
// ワーカーを独立チャンクとして出力させ、そのURLを setWorkerUrl で明示注入して回避する。
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Facility } from '@tmn/schemas';

/**
 * 施設地図(FR-012 / ADR-005・Wave3)。国土地理院の「地理院タイル(標準地図)」を背景に、
 * 座標を持つ施設をマーカー表示する。ADR-005 の利用条件検証(2026-07-23)により、地理院タイルは
 * ウェブアプリでのリアルタイム読込に限り「出典の明示のみで申請不要」で利用できる。
 *
 * 設計上の原則:
 *  - プログレッシブエンハンス: 地図の読込・初期化に失敗しても、呼び出し側の一覧表示は無傷。
 *    maplibre-gl は動的import(コード分割)し、初期化失敗は握りつぶして地図領域のみ縮退する。
 *  - プライバシー(FR-013): 距離計算・最寄り判定・現在地取得は一切しない。タイルは公共タイル
 *    サービスへの外部リクエストになるが、利用者の住所や現在地は送らない(選択済み施設の座標のみ)。
 *  - 出典明示: 地理院タイルが実際に読み込めたときだけ「地理院タイル」の出典を地図隅に出す。
 *    ADR-005 の出典明示義務はタイルを使う場合の条件であり、タイルが1枚も出ていない状態で
 *    出典だけ出すのは表示と実態の不一致になる(原則3の趣旨)。タイルが読めなければ地図領域を
 *    畳み、出典も消して一覧のみにする。
 */

/** 地理院タイル(標準地図)。出典明示のみで申請不要(ADR-005 検証済み)。 */
const GSI_STD_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_ICHIRAN_URL = 'https://maps.gsi.go.jp/development/ichiran.html';

interface FacilityMapProps {
  facilities: Facility[];
  /** 地図領域のアクセシブル名。 */
  label?: string;
}

/** lat/lng を両方持つ施設のみ(座標が無い施設は地図に出さない=捏造しない)。 */
function withCoordinates(facilities: Facility[]): (Facility & { lat: number; lng: number })[] {
  return facilities.filter(
    (f): f is Facility & { lat: number; lng: number } =>
      typeof f.lat === 'number' && typeof f.lng === 'number',
  );
}

/** ポップアップ本文をDOMで組み立てる(data由来の文字列は textContent 経由で安全に挿入)。 */
function buildPopupContent(f: Facility): HTMLElement {
  const root = document.createElement('div');
  root.className = 'text-sm';
  const name = document.createElement('p');
  name.className = 'font-semibold';
  name.textContent = f.name;
  const cat = document.createElement('p');
  cat.className = 'text-slate-600';
  cat.textContent = f.category;
  const addr = document.createElement('p');
  addr.textContent = f.address;
  root.append(name, cat, addr);
  return root;
}

/** 地図領域の状態。tiles が読めたときだけ 'ready'(=出典を出してよい状態)。 */
type MapStatus = 'loading' | 'ready' | 'failed';

/** タイルが1枚も届かないまま待ち続けないための上限(ms)。超えたら一覧のみへ縮退する。 */
const TILE_TIMEOUT_MS = 10_000;

export function FacilityMap({
  facilities,
  label = '施設の地図（地理院タイル）',
}: FacilityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const points = withCoordinates(facilities);

  useEffect(() => {
    if (points.length === 0) return;
    let cancelled = false;
    let map: MlMap | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        // 名前空間import(maplibre-gl v6 は default export を持たない)。動的importでコード分割。
        const maplibregl = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !containerRef.current) return;
        maplibregl.setWorkerUrl(maplibreWorkerUrl);

        const instance = new maplibregl.Map({
          container: containerRef.current,
          // 出典は静的オーバーレイで明示するため、maplibre既定の帰属コントロールは無効化する。
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              gsi: {
                type: 'raster',
                tiles: [GSI_STD_TILE_URL],
                tileSize: 256,
                maxzoom: 18,
                attribution: '地理院タイル',
              },
            },
            layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
          },
          center: [points[0]!.lng, points[0]!.lat],
          zoom: 12,
        });
        map = instance;
        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        // タイルが実際に1枚届いた時点で 'ready'。ワーカー欠落やタイル配信停止では
        // このイベントが来ないため、出典表示と「地図が出ている」実態を一致させられる。
        timer = setTimeout(() => {
          if (!cancelled) setStatus((s) => (s === 'ready' ? s : 'failed'));
        }, TILE_TIMEOUT_MS);
        instance.on('sourcedata', (e) => {
          if (cancelled) return;
          // e.tile は maplibre 側で any。必要な state だけを境界で narrow する。
          const tileState = (e.tile as { state?: string } | undefined)?.state;
          if (e.sourceId === 'gsi' && tileState === 'loaded') {
            if (timer) clearTimeout(timer);
            setStatus('ready');
          }
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const f of points) {
          const popup = new maplibregl.Popup({ offset: 18, closeButton: true }).setDOMContent(
            buildPopupContent(f),
          );
          new maplibregl.Marker({ color: '#1f5195' })
            .setLngLat([f.lng, f.lat])
            .setPopup(popup)
            .addTo(instance);
          bounds.extend([f.lng, f.lat]);
        }
        if (points.length > 1) {
          instance.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
        }
      } catch {
        // WebGL非対応・タイル読込不能などでも一覧は無傷(縮退のみ)。
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map?.remove();
    };
    // facilities配列の同一性で再初期化する(施設の入れ替え=自治体切替時)。
  }, [points]);

  if (points.length === 0) return null;

  // 地図が出せないと分かった時点で領域を畳む。出典表示も出さない(表示と実態を一致させる)。
  if (status === 'failed') {
    return (
      <section
        aria-label={label}
        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
      >
        <p className="text-sm text-slate-600">
          地図を表示できませんでした。窓口の名称・住所・地図へのリンクは、この下の一覧でご確認いただけます。
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
    >
      {/* aria-hidden は付けない: maplibre のズーム等の操作ボタンは focusable なため、
          aria-hidden 内に置くと aria-hidden-focus 違反になる。canvas/コントロールは
          maplibre 自身がラベル付けし、地図領域全体は section の aria-label で命名する。 */}
      <div ref={containerRef} className="h-72 w-full" />

      {/* 出典表示(地理院タイル利用条件)。タイルが実際に読み込めたときだけ出す。 */}
      {status === 'ready' && (
        <p className="absolute bottom-0 right-0 m-0 bg-white/85 px-2 py-0.5 text-[0.7rem] leading-tight text-slate-700">
          出典:{' '}
          <a
            href={GSI_ICHIRAN_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-700 underline"
          >
            地理院タイル
          </a>
        </p>
      )}

      <p className="sr-only">
        地図には座標データを持つ施設を表示しています。全施設の名称・住所は、この下の一覧でご確認いただけます。
      </p>
    </section>
  );
}
