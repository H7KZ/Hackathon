/**
 * Counterfactual "what if" (docs/handoffs/cascade.md task 3). The agent may change PARAMETERS only:
 * it returns the full curve list plus patches of existing `Param` values. Code applies them to a copy
 * of the base scenario, so meta (seed), entities, flows, processes and their references stay as they are.
 */
import { z } from "zod";
import type { Llm } from "@s2d/llm";
import type { CompileError } from "@s2d/schema/api";
import { CurveDef, Param, type Scenario } from "@s2d/schema/scenario";
import type { OnEvent } from "./events";
import { formatFeedback, repairLoop } from "./loop";
import { userPrompt, WHAT_IF } from "./prompts/index";

export const WhatIfEdit = z.object({
  curves: z.array(CurveDef).describe("the complete new list of curves (unchanged ones copied as they are)"),
  params: z
    .array(
      z.object({
        pointer: z.string().describe("JSON pointer of an existing Param, e.g. /processes/2/rate"),
        value: Param,
      }),
    )
    .describe("changes of existing Param values inside entities/flows/processes"),
  rationale: z.string().describe("one sentence in Czech: what changed and why"),
});
export type WhatIfEdit = z.infer<typeof WhatIfEdit>;

/** Parts of the scenario a what-if may never touch through a Param patch. */
const FROZEN = new Set(["meta", "curves", "storyPoints", "expectations", "noise"]);

export function applyWhatIf(
  base: Scenario,
  edit: WhatIfEdit,
): { ok: true; scenario: Scenario } | { ok: false; errors: CompileError[] } {
  const scenario = structuredClone(base);
  scenario.curves = edit.curves;
  const errors: CompileError[] = [];
  for (const [i, patch] of edit.params.entries()) {
    const at = `params.${i}.pointer`;
    const tokens = parsePointer(patch.pointer);
    if (!tokens || tokens.length < 2 || FROZEN.has(tokens[0] ?? "")) {
      errors.push({
        path: at,
        message: `"${patch.pointer}" is not allowed. Use a JSON pointer into /entities, /flows or /processes that points at an existing Param (number or {curve}).`,
      });
      continue;
    }
    const parent = resolve(scenario, tokens.slice(0, -1));
    const key = tokens[tokens.length - 1] ?? "";
    if (!isRecord(parent) || !Param.safeParse(parent[key]).success) {
      errors.push({
        path: at,
        message: `"${patch.pointer}" does not point at an existing Param. Only change values that are already a number or {curve, scale?}; do not add or remove fields.`,
      });
      continue;
    }
    parent[key] = patch.value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scenario };
}

export class WhatIfFailed extends Error {
  constructor(readonly feedback: CompileError[] | string[]) {
    super(`Protipříklad se nepodařilo sestavit:\n${formatFeedback(feedback)}`);
    this.name = "WhatIfFailed";
  }
}

export async function whatIf(
  llm: Llm,
  question: string,
  base: Scenario,
  opts: { onEvent?: OnEvent | undefined; signal?: AbortSignal | undefined } = {},
): Promise<Scenario> {
  const res = await repairLoop<WhatIfEdit>({
    step: "05_scenario",
    ...opts,
    ask: (feedback, previous, n) =>
      llm.object({
        schemaName: "what_if",
        schema: WhatIfEdit,
        instructions: WHAT_IF,
        prompt: userPrompt({
          Question: question,
          "Base scenario": base,
          ...(feedback.length > 0 && {
            [`Previous attempt (this is attempt ${n})`]: previous ?? "(did not match the schema)",
            "Errors (fix all of them, keep everything else unchanged)": formatFeedback(feedback),
          }),
        }),
      }),
    assemble: (edit) => applyWhatIf(base, edit),
  });
  if (!res.ok) throw new WhatIfFailed(res.feedback);
  opts.onEvent?.({
    type: "log",
    message: `Protipříklad hotový (${res.iterations}. pokus): ${res.output.rationale}`,
  });
  return res.scenario;
}

function parsePointer(pointer: string): string[] | undefined {
  if (!pointer.startsWith("/")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function resolve(root: unknown, tokens: string[]): unknown {
  let node: unknown = root;
  for (const t of tokens) {
    if (!isRecord(node) || !Object.hasOwn(node, t)) return undefined;
    node = node[t];
  }
  return node;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
