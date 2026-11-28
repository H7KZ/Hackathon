/**
 * Session REST + SSE (variant A, docs/api-orchestrator.md).
 * Commands: typed JSON via hc. Events: SSE with Last-Event-ID replay from events.jsonl (D9).
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ArtifactName } from "@s2d/schema/artifacts";
import { SessionCommand, SessionInput, type SessionEvent } from "@s2d/schema/api";
import { EXPORT_FORMATS } from "../ports";
import { BusyError, NotFoundError, type CommandResult, type Orchestrator } from "../orchestrator";

const HEARTBEAT_MS = 15_000;
/** ?limit= for table previews; anything unparsable falls back to 20 (the port clamps to 1..200). */
const ExportQuery = z.object({ format: z.enum(EXPORT_FORMATS).default("xlsx") });
const PreviewQuery = z.object({ limit: z.coerce.number().int().catch(20).default(20) });

/** JSON body validator; bad input → 400 with the same {path,message}[] shape the compiler uses. */
const json = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      }));
      return c.json({ ok: false as const, errors }, 400);
    }
    return undefined;
  });

export function sessionRoutes(orch: Orchestrator) {
  const accepted = (r: CommandResult) =>
    r.errors ? ({ ok: false, errors: r.errors } as const) : ({ ok: true, seq: r.seq } as const);

  const app = new Hono()
    .post("/", json(SessionInput), async (c) => {
      const { sessionId } = await orch.create(c.req.valid("json"));
      return c.json({ sessionId }, 201);
    })
    .get("/:id", (c) => c.json(orch.get(c.req.param("id"))))
    .post("/:id/commands", json(SessionCommand), (c) => {
      const res = accepted(orch.command(c.req.param("id"), c.req.valid("json")));
      return res.ok ? c.json(res, 202) : c.json(res, 422);
    })
    .get("/:id/artifacts/:name", (c) => {
      const name = ArtifactName.safeParse(c.req.param("name"));
      if (!name.success) return c.json({ error: `Neznámý artefakt "${c.req.param("name")}"` }, 404);
      return c.json({ name: name.data, value: orch.artifact(c.req.param("id"), name.data) });
    })
    .put("/:id/artifacts/:name", async (c) => {
      const name = ArtifactName.safeParse(c.req.param("name"));
      if (!name.success) return c.json({ error: `Neznámý artefakt "${c.req.param("name")}"` }, 404);
      const value: unknown = await c.req.json().catch(() => undefined);
      const res = accepted(
        orch.command(c.req.param("id"), { type: "edit_artifact", name: name.data, value }),
      );
      return res.ok ? c.json(res, 202) : c.json(res, 422);
    })
    .get("/:id/datasets/:d/evidence", async (c) =>
      c.json(await orch.evidence(c.req.param("id"), c.req.param("d"))),
    )
    .get("/:id/datasets/:d/compare/:other", async (c) =>
      c.json({ diff: await orch.compare(c.req.param("id"), c.req.param("d"), c.req.param("other")) }),
    )
    .get("/:id/datasets/:d/scenario", (c) =>
      c.json({ scenario: orch.scenario(c.req.param("id"), c.req.param("d")) }),
    )
    .get("/:id/datasets/:d/tables", async (c) =>
      c.json({ tables: await orch.tables(c.req.param("id"), c.req.param("d")) }),
    )
    .get("/:id/datasets/:d/tables/:t", zValidator("query", PreviewQuery), async (c) =>
      c.json(
        await orch.preview(c.req.param("id"), c.req.param("d"), c.req.param("t"), c.req.valid("query").limit),
      ),
    )
    .get("/:id/datasets/:d/export", zValidator("query", ExportQuery), async (c) => {
      const out = await orch.exportDataset(c.req.param("id"), c.req.param("d"), c.req.valid("query").format);
      // streamed: an xlsx of a large dataset is tens of MB
      const body = Readable.toWeb(createReadStream(out.file)) as ReadableStream<Uint8Array>;
      return c.body(body, 200, {
        "Content-Type": out.contentType,
        "Content-Disposition": `attachment; filename="${out.filename}"`,
      });
    })
    .get("/:id/datasets/:d/detective", async (c) =>
      c.json({ result: await orch.detective(c.req.param("id"), c.req.param("d")) }),
    )
    .get("/:id/events", (c) => {
      const id = c.req.param("id");
      orch.get(id); // 404 before the stream opens
      const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;
      return streamSSE(
        c,
        async (stream) => {
          const queue: SessionEvent[] = [];
          // read through functions: both change from callbacks, which TS narrowing can't see
          const pending = () => queue.length;
          const open = () => !stream.aborted;
          let wake: (() => void) | undefined;
          // subscribe before replaying so nothing falls between the file read and the live feed
          const unsubscribe = orch.subscribe(id, (e) => {
            queue.push(e);
            wake?.();
          });
          stream.onAbort(() => {
            unsubscribe();
            wake?.();
          });
          queue.unshift(...orch.events(id, after));
          let last = after;
          while (!stream.aborted) {
            for (let e = queue.shift(); e; e = queue.shift()) {
              if (e.seq <= last) continue;
              last = e.seq;
              // no `event:` field on purpose: EventSource.onmessage then receives every event; type is in data
              await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              setTimeout(resolve, HEARTBEAT_MS);
            });
            // the listener may have pushed while we waited; a ping only when nothing arrived
            if (pending() === 0 && open()) await stream.write(": ping\n\n");
          }
        },
        (err) => {
          console.error(err);
          return Promise.resolve();
        },
      );
    });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof BusyError) return c.json({ error: err.message, status: err.status }, 409);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}
