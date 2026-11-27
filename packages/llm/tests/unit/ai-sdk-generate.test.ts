import { describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<object>()), generateText }));
const { aiSdkGenerate } = await import("../../src/client");

const noObject = (text: string, finishReason: "stop" | "length") =>
  new NoObjectGeneratedError({
    text,
    finishReason,
    response: { id: "r", timestamp: new Date(0), modelId: "m" },
    usage: {} as never,
  });

const req = { schemaName: "x", schema: z.object({ a: z.number() }), instructions: "", prompt: "p" };

describe("aiSdkGenerate", () => {
  it("returns complete-but-wrong JSON so the caller's zod parse can report it", async () => {
    generateText.mockRejectedValueOnce(noObject('{"b":1}', "stop"));
    await expect(aiSdkGenerate({ ...req, model: "groq:m" })).resolves.toEqual({ b: 1 });
  });

  it("takes the JSON out of prose + a fenced block (Sonnet 5.5 with toolChoice auto, live run)", async () => {
    const text = 'I changed only the delay.\n\n- **Cause:** {not json}\n\n```json\n{"a":1}\n```';
    generateText.mockRejectedValueOnce(noObject(text, "stop"));
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).resolves.toEqual({ a: 1 });
  });

  it("takes a bare object out of surrounding prose", async () => {
    generateText.mockRejectedValueOnce(noObject('Here it is: {"a":2} (done)', "stop"));
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).resolves.toEqual({ a: 2 });
  });

  it("still throws when there is no JSON at all", async () => {
    generateText.mockRejectedValueOnce(noObject("Sorry, I cannot.", "stop"));
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).rejects.toThrow();
  });

  it("reports truncated output as a token-limit error", async () => {
    generateText.mockRejectedValueOnce(noObject('{"a":', "length"));
    await expect(aiSdkGenerate({ ...req, model: "groq:m" })).rejects.toThrow(/cut off/);
  });

  it("sends groq provider options (no strict schema, low reasoning effort)", async () => {
    generateText.mockResolvedValueOnce({ output: { a: 1 } });
    await aiSdkGenerate({ ...req, model: "groq:m" });
    expect(generateText.mock.lastCall?.[0]).toMatchObject({
      providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: "low" } },
    });
  });
});

describe("providerSafeSchema", () => {
  it("turns tuples into single-schema arrays but still validates the tuple", async () => {
    const { providerSafeSchema } = await import("../../src/client");
    const s = providerSafeSchema(z.object({ clamp: z.tuple([z.number(), z.number()]).optional() }));
    const js = JSON.stringify(s.jsonSchema);
    expect(js).not.toContain('"items":[');
    expect(js).not.toContain("additionalItems");
    expect(js).toContain('"items":{"type":"number"}');
    expect(js).toContain("exactly 2 items");
    expect((await s.validate?.({ clamp: [0, 1] }))?.success).toBe(true);
    expect((await s.validate?.({ clamp: [0, 1, 2] }))?.success).toBe(false);
  });
});
