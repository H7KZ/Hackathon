import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("applies defaults and derives folders from the repo root", () => {
    const cfg = loadConfig({}, "/repo");
    expect(cfg.port).toBe(4000);
    expect(cfg.scenariosDir.replaceAll("\\", "/")).toBe("/repo/scenarios");
  });

  it("fails fast on an invalid port", () => {
    expect(() => loadConfig({ API_PORT: "abc" }, "/repo")).toThrow(/API_PORT/);
  });
});
