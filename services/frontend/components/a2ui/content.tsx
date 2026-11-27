"use client";

import { useResolve } from "./context";
import { str, type NodeProps } from "./tree";

type Variant = "h1" | "h2" | "h3" | "label" | "body" | "caption" | "muted";

/** Plain text; `**bold**` is the only markup (no HTML, no links: nothing executable from an agent). */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}

export function Text({ node }: NodeProps) {
  const resolve = useResolve();
  const text = str(resolve(node.text));
  const variant = (node.variant as Variant | undefined) ?? "body";
  const Tag = variant === "h1" || variant === "h2" || variant === "h3" ? variant : "p";
  return (
    <Tag className={`a2-text ${variant}`}>
      <Rich text={text} />
    </Tag>
  );
}

export type Tone = "ok" | "fail" | "info" | "story" | "neutral";
/** Icons only where they carry meaning (pass, fail, story point); info/neutral are plain. */
const ICON: Record<Tone, string> = { ok: "✓", fail: "✗", info: "", story: "◆", neutral: "" };

export function Badge({ node }: NodeProps) {
  const resolve = useResolve();
  const tone = (resolve(node.tone) as Tone | undefined) ?? "neutral";
  return (
    <span className={`a2-badge ${tone}`}>
      {ICON[tone] && <span aria-hidden="true">{ICON[tone]}</span>}
      {str(resolve(node.text))}
    </span>
  );
}

export function Callout({ node }: NodeProps) {
  const resolve = useResolve();
  const tone = (resolve(node.tone) as Tone | undefined) ?? "info";
  const title = str(resolve(node.title));
  return (
    <div className={`a2-callout ${tone}`} role={tone === "fail" ? "alert" : "note"}>
      {title && <strong>{title}</strong>}
      <p>
        <Rich text={str(resolve(node.text))} />
      </p>
    </div>
  );
}
