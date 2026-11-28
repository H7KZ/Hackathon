import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** `trace`: a file that gets the key of every hit appended (LLM_CACHE_TRACE), to commit only what a replay reads. */
  constructor(
    private readonly dir: string,
    private readonly trace?: string,
  ) {}

  private file(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get(key: string): CacheEntry | undefined {
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    try {
      const entry = JSON.parse(readFileSync(f, "utf8")) as CacheEntry;
      if (this.trace)
        appendFileSync(
          this.trace,
          `${key}
`,
        );
      return entry;
    } catch {
      return undefined; // corrupt entry = miss
    }
  }

  set(entry: CacheEntry): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(entry.key), `${JSON.stringify(entry, null, 2)}\n`);
  }
}
