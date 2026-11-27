import { describe, expect, it } from "vitest";
import { testClient } from "hono/testing";
import { REPO_ROOT, loadScenarioFixture } from "@s2d/test-utils";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";

const app = createApp(loadConfig({}, REPO_ROOT));
const client = testClient(app);

describe("api", () => {
  it("GET /health", async () => {
    const res = await client.health.$get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "0.1.0" });
  });

  it("GET /scenarios lists scenario files", async () => {
    const res = await client.scenarios.$get();
    expect((await res.json()).ids).toContain("supplier_delay");
  });

  it("GET /scenarios/:id returns 404 for unknown or unsafe ids", async () => {
    expect((await client.scenarios[":id"].$get({ param: { id: "nope" } })).status).toBe(404);
    expect((await client.scenarios[":id"].$get({ param: { id: "..%2Fpackage" } })).status).toBe(404);
  });

  it("POST /scenarios/validate returns 200 for a valid scenario", async () => {
    const res = await app.request("/scenarios/validate", {
      method: "POST",
      body: JSON.stringify(loadScenarioFixture("supplier_delay")),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, errors: [] });
  });

  it("POST /scenarios/validate returns 422 with actionable errors", async () => {
    const res = await app.request("/scenarios/validate", {
      method: "POST",
      body: JSON.stringify({ meta: {} }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; errors: { path: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("POST /scenarios/validate returns 400 for malformed JSON", async () => {
    const res = await app.request("/scenarios/validate", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
