import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL, apiUrl, createSession, getHealth, localOrigin } from "../../lib/api";

describe("getHealth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the API health", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", version: "1.2.3" }));
    vi.stubGlobal("fetch", fetch);
    await expect(getHealth()).resolves.toEqual({ status: "ok", version: "1.2.3" });
    expect(fetch).toHaveBeenCalledWith(`${API_URL}/health`);
  });

  it("rejects on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(getHealth()).rejects.toThrow("HTTP 503");
  });
});

describe("createSession", () => {
  afterEach(() => vi.unstubAllGlobals());
  const input = { company: "Firma", story: "Příběh" };
  const stub = (response: Promise<Response>) => {
    const fetch = vi.fn().mockReturnValue(response);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("posts the input and returns the session id", async () => {
    const fetch = stub(Promise.resolve(Response.json({ sessionId: "abc" }, { status: 201 })));
    await expect(createSession(input)).resolves.toEqual({ ok: true, sessionId: "abc" });
    expect(fetch).toHaveBeenCalledWith(`${API_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("maps a validation error to its field", async () => {
    const body = { ok: false, errors: [{ path: "story", message: "Příliš krátké" }] };
    stub(Promise.resolve(Response.json(body, { status: 400 })));
    await expect(createSession(input)).resolves.toEqual({
      ok: false,
      message: "Příliš krátké",
      field: "story",
    });
  });

  it("explains a server error and an unreachable API in Czech", async () => {
    stub(Promise.resolve(new Response("boom", { status: 500 })));
    await expect(createSession(input)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("HTTP 500"),
    });
    stub(Promise.reject(new TypeError("fetch failed")));
    await expect(createSession(input)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("nedostupné"),
    });
  });
});

describe("API URL override (dev only, localhost only)", () => {
  afterEach(() => {
    localStorage.clear();
    window.history.pushState(null, "", "/");
  });

  it("accepts a local origin from ?api= and remembers it", () => {
    window.history.pushState(null, "", "/?api=http://localhost:4100/x");
    expect(apiUrl()).toBe("http://localhost:4100");
    window.history.pushState(null, "", "/");
    expect(apiUrl()).toBe("http://localhost:4100");
  });

  it("rejects remote or odd origins and ignores planted storage values", () => {
    for (const bad of [
      "https://evil.example",
      "javascript:alert(1)",
      "http://localhost.evil.com",
      "nonsense",
    ]) {
      window.history.pushState(null, "", `/?api=${encodeURIComponent(bad)}`);
      expect(apiUrl()).toBe(API_URL);
    }
    window.history.pushState(null, "", "/");
    localStorage.setItem("jojo.api", "https://evil.example");
    expect(apiUrl()).toBe(API_URL);
    expect(localOrigin("http://127.0.0.1:4000/")).toBe("http://127.0.0.1:4000");
  });
});
