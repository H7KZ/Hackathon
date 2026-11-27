/** Chat transport seam: the workspace talks to a ChatSource; mock and live API implement it. */
import type { A2uiAction, A2uiMessage } from "../a2ui/protocol";

export type ChatItem =
  { id: string; role: "user" | "agent"; text: string } | { id: string; role: "surface"; surfaceId: string };

export type SourceEvent =
  | { type: "a2ui"; message: A2uiMessage }
  | { type: "say"; role: "user" | "agent"; text: string }
  /** step label for the thinking indicator; `null` = idle, composer enabled */
  | { type: "busy"; step: string | null }
  /** quick replies shown above the composer; empty list hides them */
  | { type: "suggest"; items: string[] };

export type UserInput = { kind: "text"; text: string } | { kind: "action"; action: A2uiAction };

export type Emit = (event: SourceEvent) => void;

export type ChatSource = {
  /** Starts the stream; returns a stop function (cancels timers / closes EventSource). */
  start: (emit: Emit) => () => void;
  send: (input: UserInput) => void;
  /** true = scripted mock data; the UI shows a "Demo data" badge (principle 8). */
  demo: boolean;
};
