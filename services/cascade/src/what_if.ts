/**
 * Counterfactual "what if" (docs/handoffs/cascade.md task 3). The agent may change PARAMETERS only:
 * it returns the full curve list plus patches of existing `Param` values. Code applies them to a copy
 * of the base scenario, so meta (seed), entities, flows, processes and their references stay as they are.
 */
import { z } from "zod";
import type { Llm } from "@s2d/llm";
import type { CompileError } from "@s2d/schema/api";
import { CurveDef, Param, type Scenario } from "@s2d/schema/scenario";
import { checkCurveCoverage } from "./checks";
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

/** Parts of the scenario that hold Params a what-if may patch. */
const PATCHABLE = ["entities", "flows", "processes"] as const;

/** RFC 6901 escaping of one pointer token. */
const escapeToken = (token: string) => token.replace(/~/g, "~0").replace(/\//g, "~1");

/** Param slots per FieldGen `gen` (categorical weights are handled as an array). */
const GEN_PARAMS: Record<string, string[]> = {
  normal: ["mean", "sd"],
  poisson: ["lambda"],
  uniformInt: ["min", "max"],
  bernoulli: ["p"],
  topUp: ["target"],
};

/**
 * JSON pointers of every Param slot in entities/flows/processes, derived from the contract's shape.
 * A number elsewhere (entity count, lag, schedule, array length, const value) is structure, not a Param.
 */
export function paramPointers(scenario: Scenario): Set<string> {
  const out = new Set<string>();
  const visit = (node: unknown, ptr: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        visit(v, `${ptr}/${i}`);
      });
      return;
    }
    if (!isRecord(node)) return;
    const slot = (key: string) => {
      if (Param.safeParse(node[key]).success) out.add(`${ptr}/${escapeToken(key)}`);
    };
    if (node.type === "arrival") slot("rate");
    if (node.type === "derive") slot("p");
    if (node.kind === "bernoulli") slot("p");
    if (typeof node.gen === "string") {
      for (const k of GEN_PARAMS[node.gen] ?? []) slot(k);
      if (node.gen === "categorical" && Array.isArray(node.weights))
        node.weights.forEach((w, i) => {
          if (Param.safeParse(w).success) out.add(`${ptr}/weights/${i}`);
        });
    }
    for (const [k, v] of Object.entries(node)) visit(v, `${ptr}/${escapeToken(k)}`);
  };
  for (const part of PATCHABLE) visit(scenario[part], `/${part}`);
  return out;
}

export function applyWhatIf(
  base: Scenario,
  edit: WhatIfEdit,
): { ok: true; scenario: Scenario } | { ok: false; errors: CompileError[] } {
  const scenario = structuredClone(base);
  scenario.curves = edit.curves;
  const errors: CompileError[] = [];
  const allowed = paramPointers(base);
  for (const [i, patch] of edit.params.entries()) {
    const at = `params.${i}.pointer`;
    const tokens = parsePointer(patch.pointer);
    const parent = tokens && allowed.has(patch.pointer) ? resolve(scenario, tokens.slice(0, -1)) : undefined;
    if (!tokens || !isRecord(parent)) {
      errors.push({
        path: at,
        message: `"${patch.pointer}" is not a Param slot. Only rate (arrival), p (derive, bernoulli), lambda, mean, sd, uniformInt min/max, categorical weights/<i> and topUp target inside /entities, /flows or /processes can change; counts, lags, schedules, ids and structure stay as they are.`,
      });
      continue;
    }
    parent[tokens[tokens.length - 1] ?? ""] = patch.value;
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
          // meta.id comes from the session id: kept out of the prompt so the cache key (and thus an
          // offline demo replay) does not change per session; applyWhatIf keeps the real id
          "Base scenario": { ...base, meta: { ...base.meta, id: "scenario" } },
          ...(feedback.length > 0 && {
            [`Previous attempt (this is attempt ${n})`]: previous ?? "(did not match the schema)",
            "Errors (fix all of them, keep everything else unchanged)": formatFeedback(feedback),
          }),
        }),
      }),
    assemble: (edit) => applyWhatIf(base, edit),
    // a curve the edit no longer references would silently drop its story point
    check: (s) => checkCurveCoverage(s, s),
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
