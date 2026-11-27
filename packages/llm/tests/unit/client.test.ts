import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { fakeGenerate, makeTempDir } from "@s2d/test-utils";
import { createLlm, LlmCacheMiss, LlmOutputInvalid, resolveModel } from "../../src/client";
import { readLlmEnv } from "../../src/env";

const Person = z.object({ name: z.string(), age: z.number().int() });
const req = { schemaName: "person", schema: Person, prompt: "Vymysli osobu" };

describe("createLlm", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  function setup(responses: unknown[], offline = false) {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const fake = fakeGenerate(responses);
    const llm = createLlm({ generate: fake.generate, cacheDir: tmp.dir, offline, model: "anthropic:test" });
    return { llm, fake, dir: tmp.dir };
  }

  it("validates output with the schema and caches it", async () => {
    const { llm, fake, dir } = setup([{ name: "Jana", age: 31 }]);
    await expect(llm.object(req)).resolves.toEqual({ name: "Jana", age: 31 });
    // second call is served from disk, the fake is not called again
    await expect(llm.object(req)).resolves.toEqual({ name: "Jana", age: 31 });
    expect(fake.calls).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("uses a different cache key when the prompt changes", async () => {
    const { llm, fake } = setup([
      { name: "A", age: 1 },
      { name: "B", age: 2 },
    ]);
    await llm.object(req);
    await llm.object({ ...req, prompt: "jiný prompt" });
    expect(fake.calls).toHaveLength(2);
  });

  it("rejects invalid output and does not cache it", async () => {
    const { llm, dir } = setup([{ name: "X", age: "old" }]);
    await expect(llm.object(req)).rejects.toBeInstanceOf(LlmOutputInvalid);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("offline mode fails on cache miss without calling the provider", async () => {
    const { llm, fake } = setup([], true);
    await expect(llm.object(req)).rejects.toBeInstanceOf(LlmCacheMiss);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("readLlmEnv", () => {
  it("parses defaults and offline flag", () => {
    const env = readLlmEnv({ LLM_OFFLINE: "1", LLM_CACHE_DIR: "/tmp/x" });
    expect(env).toEqual({
      model: "anthropic:claude-sonnet-5-5",
      modelBySchema: {},
      offline: true,
      cacheDir: "/tmp/x",
    });
  });

  it("rejects a malformed model id with a readable message", () => {
    expect(() => readLlmEnv({ LLM_MODEL: "gpt" })).toThrow(/anthropic:<model>/);
  });

  it("accepts a groq model id (model names may contain a slash)", () => {
    expect(readLlmEnv({ LLM_MODEL: "groq:openai/gpt-oss-120b" }).model).toBe("groq:openai/gpt-oss-120b");
  });
});

describe("per-step model", () => {
  it("reads LLM_MODEL_<SCHEMA> overrides and rejects bad ids", () => {
    const env = readLlmEnv({ LLM_MODEL_01_COMPANY: "anthropic:claude-haiku-5-5", LLM_MODEL_WHAT_IF: "" });
    expect(env.modelBySchema).toEqual({ "01_company": "anthropic:claude-haiku-5-5" });
    expect(() => readLlmEnv({ LLM_MODEL_02_MODEL: "haiku" })).toThrow(/LLM_MODEL_02_MODEL/);
  });

  it("uses the override for that schemaName only", async () => {
    const tmp = makeTempDir();
    const models: string[] = [];
    const llm = createLlm({
      generate: (r) => {
        models.push(r.model);
        return Promise.resolve({ name: "A", age: 1 });
      },
      cacheDir: tmp.dir,
      offline: false,
      model: "anthropic:big",
      modelBySchema: { cheap: "anthropic:small" },
    });
    await llm.object({ ...req, schemaName: "cheap" });
    await llm.object({ ...req, schemaName: "other" });
    tmp.cleanup();
    expect(models).toEqual(["anthropic:small", "anthropic:big"]);
  });
});

describe("resolveModel", () => {
  it("maps groq:<model> to Groq's OpenAI-compatible chat endpoint", () => {
    const model = resolveModel("groq:openai/gpt-oss-120b");
    expect(typeof model).toBe("object");
    if (typeof model === "string") return;
    expect(model.modelId).toBe("openai/gpt-oss-120b");
    expect(model.provider).toMatch(/^groq/);
  });

  it("rejects an unknown provider", () => {
    expect(() => resolveModel("mistral:x")).toThrow(/Unknown LLM provider/);
  });
});

describe("createLlm cache robustness", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("caches the raw output so transforming schemas re-parse cleanly", async () => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const Upper = z.object({ name: z.string().transform((s) => s.toUpperCase()) });
    const fake = fakeGenerate([{ name: "jana" }]);
    const llm = createLlm({ generate: fake.generate, cacheDir: tmp.dir, offline: false, model: "m:x" });
    const r = { schemaName: "u", schema: Upper, prompt: "p" };
    expect(await llm.object(r)).toEqual({ name: "JANA" });
    expect(await llm.object(r)).toEqual({ name: "JANA" });
    expect(fake.calls).toHaveLength(1);
  });

  it("online: a corrupt or invalid cache entry is re-recorded instead of failing", async () => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const first = createLlm({
      generate: fakeGenerate([{ name: "A", age: 1 }]).generate,
      cacheDir: tmp.dir,
      offline: false,
      model: "m:x",
    });
    await first.object(req);
    const [file] = readdirSync(tmp.dir);
    writeFileSync(join(tmp.dir, file!), "{not json");
    const fake = fakeGenerate([{ name: "B", age: 2 }]);
    const llm = createLlm({ generate: fake.generate, cacheDir: tmp.dir, offline: false, model: "m:x" });
    expect(await llm.object(req)).toEqual({ name: "B", age: 2 });
  });
});
