/**
 * Typed REST client for services/api. Only a TYPE import from @s2d/api — no backend code in the bundle
 * (enforced by eslint + dependency-cruiser).
 */
import { hc } from "hono/client";
import type { AppType } from "@s2d/api";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = hc<AppType>(API_URL);
