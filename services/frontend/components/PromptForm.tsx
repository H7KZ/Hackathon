"use client";

import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { createSession, type CreateResult } from "../lib/api";
import {
  ACCEPTED_FILES,
  EXAMPLES,
  findMissing,
  isAccepted,
  toSessionInput,
  type PromptError,
} from "../lib/prompt";
import { Icon, ICONS } from "./icons";

export type Send = (input: { company: string; story: string }) => Promise<CreateResult>;

const ERROR_ID = "prompt-error";

export function PromptForm({ send = createSession }: { send?: Send }) {
  const [company, setCompany] = useState("");
  const [story, setStory] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<PromptError | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const busy = useRef(false); // state updates too late to stop a double submit
  const companyInput = useRef<HTMLInputElement>(null);
  const storyInput = useRef<HTMLTextAreaElement>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const dirty = Boolean(company || story || files.length);

  function changed() {
    setError(null);
    setSent(false);
  }

  function showError(next: PromptError) {
    setError(next);
    (next.field === "company" ? companyInput : storyInput).current?.focus();
  }

  function addFiles(list: FileList | null) {
    const all = Array.from(list ?? []);
    const rejected = all.filter((f) => !isAccepted(f)).map((f) => f.name);
    changed();
    setFiles((current) => [...current, ...all.filter(isAccepted)]);
    if (rejected.length) {
      setError({
        field: "story",
        invalid: false,
        message: `Soubor ${rejected.join(", ")} nelze přidat. Jen .txt, .md, .csv a .json do 200 kB.`,
      });
    }
  }

  async function submit(event?: SyntheticEvent) {
    event?.preventDefault();
    if (busy.current) return;
    const missing = findMissing(company, story, files.length);
    if (missing) {
      showError(missing);
      return;
    }
    busy.current = true;
    setSending(true);
    changed();
    try {
      const result = await send(await toSessionInput(company, story, files));
      if (result.ok) setSent(true);
      else
        showError({
          field: result.field ?? "story",
          message: result.message,
          invalid: Boolean(result.field),
        });
    } catch {
      showError({ field: "story", message: "Soubor se nepodařilo přečíst.", invalid: false });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  function onStoryKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function wipe() {
    setCompany("");
    setStory("");
    setFiles([]);
    changed();
    companyInput.current?.focus();
  }

  const fieldProps = (name: PromptError["field"]) => ({
    "aria-invalid": error?.field === name && error.invalid,
    "aria-describedby": error?.field === name ? ERROR_ID : undefined,
  });

  const bubble = (name: PromptError["field"]) =>
    error?.field === name && (
      <p id={ERROR_ID} role="alert" className="bubble">
        {error.message}
      </p>
    );

  return (
    <>
      <div className="stage">
        <form
          className="box"
          noValidate
          onSubmit={(e) => {
            void submit(e);
          }}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <div className="field">
            <label htmlFor="company">Firma</label>
            <input
              id="company"
              ref={companyInput}
              type="text"
              autoComplete="organization"
              placeholder="např. e-shop s elektronikou"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                changed();
              }}
              {...fieldProps("company")}
            />
            {bubble("company")}
          </div>
          <div className="field">
            <label htmlFor="story">Příběh</label>
            <textarea
              id="story"
              ref={storyInput}
              rows={2}
              placeholder="Co se ve firmě stalo?"
              value={story}
              onChange={(e) => {
                setStory(e.target.value);
                changed();
              }}
              onKeyDown={onStoryKey}
              {...fieldProps("story")}
            />
            {bubble("story")}
          </div>

          {files.length > 0 && (
            <ul className="files">
              {files.map((file, i) => (
                <li key={`${file.name}-${String(i)}`}>
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Odebrat ${file.name}`}
                    onClick={() => {
                      setFiles(files.filter((_, j) => j !== i));
                      changed();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="bar">
            {dirty && (
              <button type="button" className="clear" onClick={() => confirm.current?.showModal()}>
                Vymazat
              </button>
            )}
            <label className="upload">
              <Icon path={ICONS.upload} />
              <span className="tip" aria-hidden="true">
                Nahrát soubor
              </span>
              <input
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                aria-label="Nahrát soubor"
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = ""; // allow picking the same file again
                }}
              />
            </label>
            <button type="submit" className="send" aria-label="Odeslat" disabled={sending}>
              <Icon path={ICONS.send} />
            </button>
          </div>
        </form>
      </div>

      {sent && (
        <p role="status" className="sent">
          ✓ Zadání odesláno.
        </p>
      )}

      <div className="chips">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            aria-pressed={company === example.company && story === example.story}
            onClick={() => {
              setCompany(example.company);
              setStory(example.story);
              changed();
              storyInput.current?.focus();
            }}
          >
            Příklad: {example.label}
          </button>
        ))}
      </div>

      {/* native dialog: focus trap and Esc for free; "Ponechat" is the safe default */}
      <dialog ref={confirm} className="confirm" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Smazat zadání?</h2>
        <p>Firma, příběh i přiložené soubory se vymažou. Tohle nejde vrátit.</p>
        <div>
          <button type="button" autoFocus onClick={() => confirm.current?.close()}>
            Ponechat
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              confirm.current?.close();
              wipe();
            }}
          >
            Smazat
          </button>
        </div>
      </dialog>
    </>
  );
}
