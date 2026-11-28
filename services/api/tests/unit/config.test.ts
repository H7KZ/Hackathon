import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("applies defaults and derives folders from the repo root", () => {
    const cfg = loadConfig({}, "/repo");
    expect(cfg.port).toBe(4000);
    expect(cfg.scenariosDir.replaceAll("\\", "/")).toBe("/repo/scenarios");
  });

  it("uses real ports unless API_FAKE lists services to fake", () => {
    expect(loadConfig({}, "/repo").fake).toEqual([]);
    expect(loadConfig({ API_FAKE: "cascade, dataer" }, "/repo").fake).toEqual(["cascade", "dataer"]);
    expect(loadConfig({ API_FAKE: "all" }, "/repo").fake).toEqual(["cascade", "noiser", "dataer"]);
    expect(() => loadConfig({ API_FAKE: "llm" }, "/repo")).toThrow(/API_FAKE/);
    expect(loadConfig({}, "/repo").cascadeDesign).toBe("v1");
    expect(loadConfig({ CASCADE_DESIGN: "causal" }, "/repo").cascadeDesign).toBe("causal");
    expect(() => loadConfig({ CASCADE_DESIGN: "v2" }, "/repo")).toThrow(/CASCADE_DESIGN/);
  });

  it("RUNS_DIR moves session state (relative to the repo root)", () => {
    expect(loadConfig({}, "/repo").runsDir.replaceAll("\\", "/")).toBe("/repo/runs");
    expect(loadConfig({ RUNS_DIR: "runs-b" }, "/repo").runsDir.replaceAll("\\", "/")).toMatch(/runs-b$/);
  });

  it("CORS_ORIGIN takes a comma list", () => {
    expect(loadConfig({}, "/repo").corsOrigin).toEqual(["http://localhost:3000"]);
    expect(
      loadConfig({ CORS_ORIGIN: "http://localhost:3000, http://localhost:3310" }, "/repo").corsOrigin,
    ).toEqual(["http://localhost:3000", "http://localhost:3310"]);
  });

  it("fails fast on an invalid port", () => {
    expect(() => loadConfig({ API_PORT: "abc" }, "/repo")).toThrow(/API_PORT/);
  });
});
