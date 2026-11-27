export { createApp, API_VERSION, type AppType } from "./app";
export { loadConfig, type ApiConfig } from "./config";
// Session contract types for the frontend (type-only import). Runtime zod schemas move to
// @s2d/schema/api once the schema owner approves contract.draft.ts.
export type {
  CascadeEvent,
  DatasetEvidence,
  DatasetInfo,
  DetectiveResult,
  GenerationSettings,
  SessionCommand,
  SessionEvent,
  SessionInput,
  SessionState,
  SessionStatus,
} from "./contract.draft";
