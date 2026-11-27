/**
 * The single backend service. Routes call @s2d/{noiser,dataer,cascade} as plain functions.
 * `AppType` is imported (type-only) by the frontend for a typed REST client (hono/client).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Health } from "@s2d/schema/api";
import { portsFor } from "./adapters";
import type { ApiConfig } from "./config";
import { createOrchestrator, type Orchestrator } from "./orchestrator";
import { scenarioRoutes } from "./routes/scenarios";
import { sessionRoutes } from "./routes/sessions";

export const API_VERSION = "0.1.0";

export function createApp(cfg: ApiConfig, opts: { log?: boolean; orchestrator?: Orchestrator } = {}) {
  const orchestrator =
    opts.orchestrator ?? createOrchestrator({ ports: portsFor(cfg), runsDir: cfg.runsDir });
  const app = new Hono();
  app.use("*", cors({ origin: cfg.corsOrigin }));
  if (opts.log) app.use("*", logger());

  const routes = app
    .get("/health", (c) => c.json({ status: "ok", version: API_VERSION } satisfies Health))
    .route("/scenarios", scenarioRoutes(cfg))
    .route("/sessions", sessionRoutes(orchestrator));

  app.onError((err, c) => {
    console.error(err);
    // never leak internals (paths, stack) to the client; details are in the server log
    return c.json({ error: "Internal server error" }, 500);
  });

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
