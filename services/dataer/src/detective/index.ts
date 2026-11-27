/**
 * Detective entry point: the LLM loop runs on a temporary sandbox (main tables only); scoring then reads
 * truth.story_points from the full db, outside the LLM's reach.
 */
import type { Llm } from "@s2d/llm";
import type { DetectiveReport, DetectiveScore } from "@s2d/schema/detective";
import { withSandbox } from "../store/sandbox";
import { readTruthPoints } from "../store/truth";
import { runDetective, type DetectiveEvent } from "./loop";
import { scoreFindings } from "./score";

export async function detective(
  dbPath: string,
  opts: { llm: Llm; onEvent?: (e: DetectiveEvent) => void; signal?: AbortSignal; maxSteps?: number },
): Promise<{ report: DetectiveReport; score: DetectiveScore }> {
  const report = await withSandbox(dbPath, (sandbox) => runDetective({ ...opts, sandbox }));
  return { report, score: scoreFindings(report.findings, await readTruthPoints(dbPath)) };
}
