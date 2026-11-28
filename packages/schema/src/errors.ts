/** Compiler error shape, shared by api.ts and artifacts.ts (own file so the two never import each other in a cycle). */
import { z } from "zod";

export const CompileError = z.object({ path: z.string(), message: z.string() });
export type CompileError = z.infer<typeof CompileError>;
