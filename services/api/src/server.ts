import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";

const cfg = loadConfig();
const app = createApp(cfg, { log: true });

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
