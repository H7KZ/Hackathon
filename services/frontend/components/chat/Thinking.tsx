"use client";

import { useEffect, useState } from "react";
import { PHRASE_MS, phraseAt } from "../../lib/chat/phrases";
import { YoyoSpinner } from "../yoyo-spinner";

/** "The machine is working": fixed step label + rotating phrase (principle 4). */
export function Thinking({ step, onCancel }: { step: string; onCancel?: (() => void) | undefined }) {
  // start where the clock is, so each new step does not open with the same phrase
  const [tick, setTick] = useState(() => Math.floor(Date.now() / PHRASE_MS));
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
    }, PHRASE_MS);
    return () => {
      clearInterval(t);
    };
  }, []);
  return (
    <div className="thinking" aria-live="polite">
      <YoyoSpinner size={48} label={step} />
      <span>
        <strong>{step}</strong>
        <span key={tick} className="phrase" suppressHydrationWarning>
          {phraseAt(tick)}
        </span>
      </span>
      {onCancel && (
        <button type="button" className="thinking-cancel" onClick={onCancel}>
          Zrušit
        </button>
      )}
    </div>
  );
}
