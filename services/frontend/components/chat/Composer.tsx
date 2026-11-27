"use client";

import { useState, type KeyboardEvent } from "react";
import { Icon, ICONS } from "../icons";

/** Chat input: Enter sends, Shift+Enter = new line. Quick replies above it. */
export function Composer({
  disabled,
  suggestions,
  onSend,
}: {
  disabled: boolean;
  suggestions: string[];
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const send = (value = text) => {
    const v = value.trim();
    if (!v || disabled) return;
    onSend(v);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <div className="suggest" aria-label="Návrhy otázek">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => {
                send(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer-box"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Zpráva
        </label>
        <textarea
          id="chat-input"
          rows={1}
          placeholder={disabled ? "Pracuji…" : "Zeptejte se: Co kdyby…?"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={onKey}
        />
        <button
          type="submit"
          className="send"
          aria-label="Odeslat zprávu"
          disabled={disabled || !text.trim()}
        >
          <Icon path={ICONS.send} />
        </button>
      </form>
    </div>
  );
}
