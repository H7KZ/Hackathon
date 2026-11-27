/**
 * The one way to run LLM-written SQL (expectations, detective): a main-only, read-only copy of the run
 * in a fresh temp directory, removed (with its .wal) after use even if `fn` throws. A unique path per
 * call means concurrent evidence and detective runs on the same db never collide.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSandbox, openSandbox, type Store } from "./duckdb";

export async function withSandbox<T>(
  dbPath: string,
  fn: (sandbox: Store) => Promise<T>,
  opts: { tmpRoot?: string } = {},
): Promise<T> {
  const dir = mkdtempSync(join(opts.tmpRoot ?? tmpdir(), "s2d-sandbox-"));
  try {
    const path = join(dir, "sandbox.duckdb");
    await exportSandbox(dbPath, path);
    const sandbox = await openSandbox(path);
    try {
      return await fn(sandbox);
    } finally {
      sandbox.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
