import { createHash } from "node:crypto";

export function canonicalJSON(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map((child) => child === undefined ? null : ordered(child));
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Cannot hash a nonfinite decision value");
    return item;
  }
  return JSON.stringify(ordered(value));
}
export function stableHash(value: unknown): string { return createHash("sha256").update(canonicalJSON(value)).digest("hex"); }

export class DecisionCache {
  private entries = new Map<string, { value: unknown; bytes: number }>();
  private bytes = 0;
  hits = 0; misses = 0;
  constructor(private maxEntries = 32, private maxBytes = 64 * 1024 * 1024) {}
  remember<T>(key: string, compute: () => T): T {
    const previous = this.entries.get(key);
    if (previous) {
      this.hits++; this.entries.delete(key); this.entries.set(key, previous);
      return structuredClone(previous.value) as T;
    }
    this.misses++;
    const value = compute();
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes <= this.maxBytes) {
      while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
      }
      this.entries.set(key, { value: structuredClone(value), bytes }); this.bytes += bytes;
    }
    return value;
  }
  clear() { this.entries.clear(); this.bytes = 0; this.hits = 0; this.misses = 0; }
  stats() { return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses }; }
}
export const decisionCache = new DecisionCache();
