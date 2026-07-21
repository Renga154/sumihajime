import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// なぜ: 各テスト後にDOMとlocalStorageを掃除し、テスト間の状態漏れを防ぐ。
afterEach(() => {
  cleanup();
  localStorage.clear();
});
