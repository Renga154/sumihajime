/**
 * API の版(/api/health が返す)。唯一の定義。
 *
 * なぜ package.json を実行時に読まないか: Worker の束ね方(wrangler/esbuild)に JSON の取り込みを
 * 依存させたくないため。代わりに version.test.ts が apps/api/package.json の version と一致することを
 * 検査し、片方だけ上げる事故を防ぐ(以前は index.ts に '0.0.1' を直書きしていた)。
 */
export const API_VERSION = '0.0.1';
