/**
 * Vitest Test Setup
 * Global test configuration and mocks
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom';

function createStorageMock() {
  let store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(String(key), String(value));
    }),
  };
}

// Mock window.electron API
const mockElectron = {
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  },
  openExternal: vi.fn(),
  platform: 'darwin',
  isDev: true,
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'electron', {
    value: mockElectron,
    writable: true,
  });

  const localStorageMock = createStorageMock();
  const sessionStorageMock = createStorageMock();

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    writable: true,
    configurable: true,
  });
}

// Mock matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.electron.platform = 'darwin';
  }
});
