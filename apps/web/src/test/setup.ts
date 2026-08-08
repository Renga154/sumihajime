import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// なぜ: jsdom は window.scrollTo を実装せず、呼ばれるたびに "Not implemented" を吐く。
// Layout の <ScrollRestoration /> が遷移ごとに呼ぶため、素の jsdom では本物の失敗が
// ノイズに埋もれる。呼び出し自体は spy で観測できるようにしておく。
vi.stubGlobal('scrollTo', vi.fn());

// なぜ: 各テスト後にDOMとlocalStorageを掃除し、テスト間の状態漏れを防ぐ。
afterEach(() => {
  cleanup();
  localStorage.clear();
});
