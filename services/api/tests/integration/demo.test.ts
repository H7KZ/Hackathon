/**
 * Demo cases (docs/demo-data.md): each hand-written case must hold up to the same gates as LLM output,
 * and the bundle committed for the UI must be exactly what recording it today produces.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkCurveCoverage,
  checkCurvesOnRoots,
  checkEntityIds,
  checkInfluenceRefs,
  checkStoryPlan,
  storyGate,
} from "@s2d/cascade";
import { DemoBundle, DemoIndex } from "@s2d/schema/demo";
import { REPO_ROOT, makeTempDir } from "@s2d/test-utils";
import { demoArtifacts, demoCascadePort, loadDemoCases } from "../../src/adapters/demo";
import { recordCase } from "../../src/demo/record";

const cases = loadDemoCases(join(REPO_ROOT, "scenarios"));
const PUBLIC = join(REPO_ROOT, "services/frontend/public");
const tmp = makeTempDir("demo-record");
afterAll(() => {
  tmp.cleanup();
});

describe("demo cases", () => {
  it("are listed in the committed index, in file order", () => {
    expect(cases.map((c) => c.demo.id)).toEqual(["card_fraud", "eshop_carrier", "isp_firmware"]);
    const index = DemoIndex.parse(JSON.parse(readFileSync(join(PUBLIC, "demo/index.json"), "utf8")));
    expect(index.cases.map((c) => c.id)).toEqual(cases.map((c) => c.demo.id));
  });

  describe.each(cases.map((c) => [c.demo.id, c] as const))("%s", (_id, c) => {
    const story = {
      storyPoints: c.scenario.storyPoints,
      curves: c.scenario.curves,
      expectations: c.scenario.expectations,
    };

    it("passes the cascade's checks on 04_story, 03_influences and the scenario", () => {
      expect(checkStoryPlan(story)).toEqual([]);
      expect(checkEntityIds(story, c.scenario.entities)).toEqual([]);
      expect(checkInfluenceRefs(c.demo.influences, c.scenario)).toEqual([]);
      expect(checkCurvesOnRoots(c.scenario, c.demo.influences)).toEqual([]);
      expect(checkCurveCoverage(c.scenario, story)).toEqual([]);
      const first = c.scenario.curves.flatMap((x) => x.segments.map((s) => s.start)).sort()[0] ?? "";
      expect((Date.parse(first) - Date.parse(c.scenario.meta.start)) / 86_400_000).toBeLessThanOrEqual(120);
    });

    it("tells its story at seed 42 and at >= 4 of seeds 1..5 (story gate: integrity, hypotheses, flat baseline)", async () => {
      expect(await storyGate(c.scenario)).toEqual([]);
      let passes = 0;
      for (const seed of [1, 2, 3, 4, 5])
        if ((await storyGate({ ...c.scenario, meta: { ...c.scenario.meta, seed } })).length === 0) passes++;
      expect(passes).toBeGreaterThanOrEqual(4);
    }, 240_000);

    it("records exactly the committed bundle (re-run `pnpm demo:record` after changing the case)", async () => {
      const fresh = await recordCase(c, tmp.dir, () => undefined);
      const committed = DemoBundle.parse(
        JSON.parse(readFileSync(join(PUBLIC, `demo/${c.demo.id}.json`), "utf8")),
      );
      expect(JSON.parse(JSON.stringify(fresh))).toEqual(committed);
      expect(fresh.datasets.map((d) => d.id)).toEqual(["dat1", "dat2", "dat3"]);
      const det = fresh.responses["/datasets/dat1/detective"] as { result: { score: { recall: number } } };
      expect(det.result.score.recall).toBeGreaterThanOrEqual(0.6);
    }, 240_000);

    it("derives 02_model and 04_story from the scenario", () => {
      const a = demoArtifacts(c);
      expect(a["04_story"]).toEqual(story);
      expect(a["02_model"]).toEqual({
        entities: c.scenario.entities,
        flows: c.scenario.flows,
        processes: c.scenario.processes,
      });
    });
  });

  it("the demo what-if answers only its prepared questions, naming them", async () => {
    const c = cases[0];
    if (!c) throw new Error("no demo cases");
    const port = demoCascadePort(cases);
    const opts = { onEvent: () => undefined, signal: new AbortController().signal };
    const w = c.demo.whatIfs[0];
    if (!w) throw new Error("no what-if");
    const next = await port.whatIf(w.question, c.scenario, opts);
    expect(next.curves.find((x) => x.id === w.curves[0]?.id)).toEqual(w.curves[0]);
    await expect(port.whatIf("Co kdyby pršelo?", c.scenario, opts)).rejects.toThrow(
      /připravené jen otázky „/,
    );
  });
});
