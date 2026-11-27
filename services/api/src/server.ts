import { serve } from "@hono/node-server";
import { portsFor } from "./adapters";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createOrchestrator } from "./orchestrator";

const cfg = loadConfig();
const orchestrator = createOrchestrator({ ports: portsFor(cfg), runsDir: cfg.runsDir });
// tsx watch restarts on every save: sessions caught mid-job become "interrupted" (manual resume, D5)
orchestrator.recover();
const app = createApp(cfg, { log: true, orchestrator });
if (cfg.fake.length) console.log(`API_FAKE: fake ${cfg.fake.join(", ")}`);

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
