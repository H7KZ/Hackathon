/** Progress events for the UI timeline. The contract lives in `@s2d/schema/artifacts`. */
import type { CascadeEvent } from "@s2d/schema/artifacts";

export type { CascadeEvent };
export type OnEvent = (e: CascadeEvent) => void;
