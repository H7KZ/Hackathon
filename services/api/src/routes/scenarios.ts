import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { compileScenario } from "@s2d/noiser";
import type { ValidateResponse } from "@s2d/schema/api";
import type { ApiConfig } from "../config";

const ID = /^[a-z0-9_-]+$/;

export function scenarioRoutes(cfg: ApiConfig) {
  const readRaw = (id: string): unknown =>
    JSON.parse(readFileSync(join(cfg.scenariosDir, `${id}.json`), "utf8"));

  return new Hono()
    .get("/", (c) => {
      const ids = readdirSync(cfg.scenariosDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort();
      return c.json({ ids });
    })
    .get("/:id", (c) => {
      const id = c.req.param("id");
      if (!ID.test(id) || !existsSync(join(cfg.scenariosDir, `${id}.json`))) {
        return c.json({ error: `Scenario "${id}" not found` }, 404);
      }
      return c.json({ id, scenario: readRaw(id) });
    })
    .post("/validate", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Request body must be valid JSON" }, 400);
      }
      const result = compileScenario(body);
      const response: ValidateResponse = result.ok
        ? { ok: true, errors: [] }
        : { ok: false, errors: result.errors };
      return c.json(response, result.ok ? 200 : 422);
    });
}
