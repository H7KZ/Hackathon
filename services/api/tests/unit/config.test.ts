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
  });

  it("fails fast on an invalid port", () => {
    expect(() => loadConfig({ API_PORT: "abc" }, "/repo")).toThrow(/API_PORT/);
  });
});
