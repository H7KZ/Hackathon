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
    await expect(aiSdkGenerate({ ...req, model: "openai:m" })).resolves.toEqual({ a: 1 });
  });

  it("takes a bare object out of surrounding prose", async () => {
    generateText.mockRejectedValueOnce(noObject('Here it is: {"a":2} (done)', "stop"));
    await expect(aiSdkGenerate({ ...req, model: "openai:m" })).resolves.toEqual({ a: 2 });
  });

  it("still throws when there is no JSON at all", async () => {
    generateText.mockRejectedValueOnce(noObject("Sorry, I cannot.", "stop"));
    await expect(aiSdkGenerate({ ...req, model: "openai:m" })).rejects.toThrow();
  });

  it("reports truncated output as a token-limit error", async () => {
    generateText.mockRejectedValueOnce(noObject('{"a":', "length"));
    await expect(aiSdkGenerate({ ...req, model: "groq:m" })).rejects.toThrow(/cut off/);
  });

  it("asks Anthropic for JSON in text, not a forced tool (Sonnet 5.5 rejects toolChoice required)", async () => {
    generateText.mockResolvedValueOnce({ text: 'Done.\n```json\n{"a":3}\n```', finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, instructions: "sys", model: "anthropic:m" })).resolves.toEqual({
      a: 3,
    });
    const call = generateText.mock.lastCall?.[0] as Record<string, unknown>;
    expect(call.output).toBeUndefined();
    expect(call.toolChoice).toBeUndefined();
    expect(String(call.instructions)).toMatch(/^sys\n\n/);
    expect(String(call.instructions)).toContain('"a"');
  });

  it("reports cut-off Anthropic text as a token-limit error", async () => {
    generateText.mockResolvedValueOnce({ text: '{"a":', finishReason: "length" });
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).rejects.toThrow(/cut off/);
  });

  it("asks once more when the answer has no JSON (live detective step), then throws", async () => {
    generateText
      .mockResolvedValueOnce({ text: "I will now look at the data.", finishReason: "stop" })
      .mockResolvedValueOnce({ text: '{"a":4}', finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).resolves.toEqual({ a: 4 });
    const retry = generateText.mock.lastCall?.[0] as { messages?: { role: string; content: string }[] };
    expect(retry.messages?.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry.messages?.[1]?.content).toBe("I will now look at the data.");
    generateText
      .mockResolvedValueOnce({ text: "Sorry.", finishReason: "stop" })
      .mockResolvedValueOnce({ text: "Still no.", finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).rejects.toThrow(/no JSON/);
  });

  it("sends groq provider options (no strict schema, low reasoning effort)", async () => {
    generateText.mockResolvedValueOnce({ output: { a: 1 } });
    await aiSdkGenerate({ ...req, model: "groq:m" });
    expect(generateText.mock.lastCall?.[0]).toMatchObject({
      providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: "low" } },
    });
  });

  it("sends openai a non-strict schema too (strict mode needs every field required)", async () => {
    generateText.mockResolvedValueOnce({ output: { a: 1 } });
    await aiSdkGenerate({ ...req, model: "openai:gpt-5-mini" });
    expect(generateText.mock.lastCall?.[0]).toMatchObject({
      providerOptions: { openai: { strictJsonSchema: false } },
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

  it("rewrites oneOf (discriminated unions) as anyOf: OpenAI rejects oneOf (live run 3)", async () => {
    const { providerSafeSchema } = await import("../../src/client");
    const u = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("a"), x: z.number() }),
      z.object({ kind: z.literal("b"), y: z.string() }),
    ]);
    const s = providerSafeSchema(z.object({ items: z.array(u) }));
    const js = JSON.stringify(s.jsonSchema);
    expect(js).not.toContain("oneOf");
    expect(js).toContain("anyOf");
    expect((await s.validate?.({ items: [{ kind: "a", x: 1 }] }))?.success).toBe(true);
    expect((await s.validate?.({ items: [{ kind: "a", y: "z" }] }))?.success).toBe(false);
  });
});

describe("anthropic text mode corrects schema misses (live detective_step: no `action`)", () => {
  it("sends the zod issues back once and returns the corrected object", async () => {
    const schema = z.object({ action: z.object({ kind: z.string() }) });
    generateText
      .mockResolvedValueOnce({ text: '{"kind":"sql"}', finishReason: "stop" })
      .mockResolvedValueOnce({ text: '{"action":{"kind":"sql"}}', finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, schema, model: "anthropic:m" })).resolves.toEqual({
      action: { kind: "sql" },
    });
    const retry = generateText.mock.lastCall?.[0] as { messages?: { role: string; content: string }[] };
    expect(retry.messages?.[2]?.content).toMatch(/does not match the schema/);
    expect(retry.messages?.[2]?.content).toMatch(/action/);
  });

  it("returns the last answer when it still misses (the caller's parse reports it)", async () => {
    const schema = z.object({ action: z.object({ kind: z.string() }) });
    generateText
      .mockResolvedValueOnce({ text: '{"kind":"a"}', finishReason: "stop" })
      .mockResolvedValueOnce({ text: '{"kind":"b"}', finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, schema, model: "anthropic:m" })).resolves.toEqual({ kind: "b" });
  });
});

describe("hung requests (live: a detective step waited 15+ minutes for one answer)", () => {
  const timeout = () =>
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it("every request carries an abort signal and a timed-out one is retried once", async () => {
    generateText.mockReset();
    generateText
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce({ text: '{"a":3}', finishReason: "stop" });
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).resolves.toEqual({ a: 3 });
    expect(generateText).toHaveBeenCalledTimes(2);
    for (const [args] of generateText.mock.calls)
      expect((args as { abortSignal?: unknown }).abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("gives up after the retry with a readable error", async () => {
    generateText.mockReset();
    generateText.mockRejectedValue(timeout());
    await expect(aiSdkGenerate({ ...req, model: "anthropic:m" })).rejects.toThrow(/did not answer within/);
    generateText.mockReset();
  });
});
