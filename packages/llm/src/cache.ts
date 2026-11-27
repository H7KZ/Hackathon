import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CacheEntry {
  key: string;
  model: string;
  schemaName: string;
  output: unknown;
}

/** Key = hash(model, instructions, prompt, JSON schema) — SPEC §2 rule 10. */
export function cacheKey(parts: {
  model: string;
  instructions: string;
  prompt: string;
  jsonSchema: unknown;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.model, parts.instructions, parts.prompt, parts.jsonSchema]))
    .digest("hex")
    .slice(0, 32);
}

export class DiskCache {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get(key: string): CacheEntry | undefined {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as CacheEntry;
    } catch {
      return undefined; // corrupt entry = miss
    }
  }

  set(entry: CacheEntry): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(entry.key), `${JSON.stringify(entry, null, 2)}\n`);
  }
}
