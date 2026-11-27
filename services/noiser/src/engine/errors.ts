/**
 * Runtime error of the engine. `path` points into the scenario (same format as compiler errors),
 * so `generate()` can hand it back to agent A5 as a `{ path, message }` item.
 */
export class EngineError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
