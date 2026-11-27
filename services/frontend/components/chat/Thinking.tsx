"use client";

import { useEffect, useState } from "react";
import { PHRASE_MS, phraseAt } from "../../lib/chat/phrases";

/** "The machine is working": fixed step label + rotating phrase (principle 4). */
export function Thinking({ step }: { step: string }) {
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
    <div className="thinking" role="status" aria-live="polite">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>{step}</strong>
        <span key={tick} className="phrase" suppressHydrationWarning>
          {phraseAt(tick)}
        </span>
      </span>
    </div>
  );
}
