// @tmn/domain — domain entity types, category constants, municipality codes.
// 実データ型は @tmn/schemas 側にあり、ここは「web と api の両方が同じ値を見る必要がある定数」を置く。

/** Placeholder package version. Replaced by real domain exports later. */
export const DOMAIN_PACKAGE_VERSION = '0.0.1';

export {
  SPA_ROUTES,
  isKnownSpaPath,
  sitemapPaths,
  type SpaRoute,
  type SpaRoutePath,
} from './routes.js';
export { BROWSER_EXTERNAL_ORIGINS, GSI_STD_TILE_URL, GSI_TILE_ORIGIN } from './external-origins.js';
export {
  ALLOWED_HOST_EXACT,
  ALLOWED_HOST_SUFFIXES,
  isOfficialHost,
  isOfficialUrl,
} from './official-host.js';
