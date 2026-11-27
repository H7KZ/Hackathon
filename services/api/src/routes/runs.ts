import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { GenerateRequest } from "@s2d/schema/api";
import type { ApiConfig } from "../config";
import { generateRun } from "../runs";

const ID = /^[a-z0-9_-]+$/;

/** POST /runs { scenarioId, seed?, scale? } -> 201 run summary | 400 | 404 | 422 { ok: false, errors }. */
export function runRoutes(cfg: ApiConfig) {
  return new Hono().post(
    "/",
    zValidator("json", GenerateRequest, (result, c) => {
      if (!result.success)
        return c.json({ error: "Body must be { scenarioId: string, seed?: int, scale?: > 0 }" }, 400);
      return undefined;
    }),
    async (c) => {
      const { scenarioId, seed, scale } = c.req.valid("json");
      if (!ID.test(scenarioId)) return c.json({ error: "scenarioId must match [a-z0-9_-]+" }, 400);
      const file = join(cfg.scenariosDir, `${scenarioId}.json`);
      if (!existsSync(file)) return c.json({ error: `Scenario "${scenarioId}" not found` }, 404);
      const result = await generateRun(cfg.outDir, JSON.parse(readFileSync(file, "utf8")), { seed, scale });
      if (!result.ok) return c.json(result, 422);
      return c.json(result, 201);
    },
  );
}
