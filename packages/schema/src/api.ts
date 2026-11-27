/** REST API request/response shapes shared by services/api and services/frontend. */
import { z } from "zod";

export const CompileError = z.object({ path: z.string(), message: z.string() });
export type CompileError = z.infer<typeof CompileError>;

export const Health = z.object({ status: z.literal("ok"), version: z.string() });
export type Health = z.infer<typeof Health>;

export const ValidateResponse = z.object({ ok: z.boolean(), errors: z.array(CompileError) });
export type ValidateResponse = z.infer<typeof ValidateResponse>;

export const GenerateRequest = z.object({
  scenarioId: z.string(),
  seed: z.number().int().optional(),
  scale: z.number().positive().optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;
