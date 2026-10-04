import { vi } from "vitest";

// Node's experimental localStorage can shadow jsdom's Storage in Vitest.
export function resetBrowserStorage() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() { return entries.size; },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
    key: (index) => [...entries.keys()][index] ?? null
  };
  vi.stubGlobal("localStorage", storage);
}
