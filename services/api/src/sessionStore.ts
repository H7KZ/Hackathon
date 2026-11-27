/**
 * On-disk session state (D5): runs/<sessionId>/{session.json, events.jsonl, job.json, datasets/dN/...}.
 * The disk is the source of truth; the orchestrator keeps only listeners and AbortControllers in memory.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SessionCommand, SessionEvent, SessionState } from "./contract.draft";

const SESSION_ID = /^[0-9a-f-]{36}$/;
const DATASET_ID = /^d[0-9]+$/;

/** A job that can be re-run by `resume` (D5). `fallback` = status after cancel or a recoverable error. */
export const JobSpec = z.object({
  kind: z.enum(["draft", "approve", "what_if", "edit_scenario", "detect"]),
  command: SessionCommand.optional(),
  fallback: SessionState.shape.status,
});
export type JobSpec = z.infer<typeof JobSpec>;

export class NotFoundError extends Error {}

export function isSessionId(id: string): boolean {
  return SESSION_ID.test(id);
}

export function sessionStore(runsDir: string) {
  const dir = (id: string) => {
    if (!isSessionId(id)) throw new NotFoundError(`Session "${id}" not found`);
    return join(runsDir, id);
  };
  const file = (id: string, name: string) => join(dir(id), name);
  const writeAtomic = (path: string, value: unknown) => {
    writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${path}.tmp`, path);
  };

  return {
    dir,
    artifactPath: (id: string, name: string) => file(id, `${name}.json`),
    datasetDir(id: string, datasetId: string) {
      if (!DATASET_ID.test(datasetId)) throw new NotFoundError(`Dataset "${datasetId}" not found`);
      return join(dir(id), "datasets", datasetId);
    },

    init(state: SessionState) {
      mkdirSync(dir(state.id), { recursive: true });
      writeAtomic(file(state.id, "session.json"), state);
    },
    read(id: string): SessionState {
      const path = file(id, "session.json");
      if (!existsSync(path)) throw new NotFoundError(`Session "${id}" not found`);
      return SessionState.parse(JSON.parse(readFileSync(path, "utf8")));
    },
    write(state: SessionState) {
      writeAtomic(file(state.id, "session.json"), state);
    },
    list(): string[] {
      if (!existsSync(runsDir)) return [];
      return readdirSync(runsDir).filter(
        (d) => isSessionId(d) && existsSync(join(runsDir, d, "session.json")),
      );
    },

    append(id: string, event: SessionEvent) {
      appendFileSync(file(id, "events.jsonl"), `${JSON.stringify(event)}\n`);
    },
    events(id: string): SessionEvent[] {
      const path = file(id, "events.jsonl");
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => SessionEvent.parse(JSON.parse(line)));
    },

    readJob(id: string): JobSpec | null {
      const path = file(id, "job.json");
      return existsSync(path) ? JobSpec.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
    },
    writeJob(id: string, job: JobSpec) {
      writeAtomic(file(id, "job.json"), job);
    },
    clearJob(id: string) {
      rmSync(file(id, "job.json"), { force: true });
    },

    writeJson: writeAtomic,
    readJson(path: string): unknown {
      if (!existsSync(path)) throw new NotFoundError(`Not found: ${path.split(/[\\/]/).slice(-2).join("/")}`);
      return JSON.parse(readFileSync(path, "utf8"));
    },
  };
}
export type SessionStore = ReturnType<typeof sessionStore>;
