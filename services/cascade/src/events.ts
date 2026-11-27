/**
 * Progress events for the UI timeline. Mirrors `CascadeEvent` in services/api/src/contract.draft.ts
 * (cascade may not import services/api). When that contract moves to @s2d/schema, import it from there
 * and delete this type; until then the API adapter's typecheck keeps both in sync.
 */
import type { CompileError } from "@s2d/schema/api";
import type { ArtifactName } from "@s2d/schema/artifacts";

export type CascadeEvent =
  | { type: "step.started"; step: ArtifactName }
  | { type: "step.done"; step: ArtifactName; cached: boolean }
  | {
      type: "loop.iteration";
      step: ArtifactName;
      n: number;
      ok: boolean;
      feedback: CompileError[] | string[];
    }
  | { type: "log"; message: string };

export type OnEvent = (e: CascadeEvent) => void;
