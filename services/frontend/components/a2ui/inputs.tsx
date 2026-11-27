"use client";

import { useId } from "react";
import type { ActionEvent } from "../../lib/a2ui/protocol";
import { useAction, useBinding, useResolve } from "./context";
import { Node, str, type NodeProps } from "./tree";

export function Button({ node }: NodeProps) {
  const resolve = useResolve();
  const fire = useAction();
  const variant = (node.variant as string | undefined) ?? "secondary";
  return (
    <button
      type="button"
      className={`a2-button ${variant}`}
      disabled={resolve(node.disabled) === true}
      onClick={() => {
        fire(node.id, node.action as ActionEvent | undefined);
      }}
    >
      {node.child ? <Node id={node.child} /> : str(resolve(node.label))}
    </button>
  );
}

/** `variant`: text (default) | longText | number (writes a number; empty = removed). */
export function TextField({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<string | number>(node.value);
  const id = useId();
  const variant = (node.variant as string | undefined) ?? (node.multiline ? "longText" : "text");
  const common = {
    id,
    value: value ?? "",
    placeholder: str(resolve(node.placeholder)),
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      if (variant === "number") setValue(v === "" ? (undefined as unknown as number) : Number(v));
      else setValue(v);
    },
  };
  return (
    <div className="a2-field" style={{ flexGrow: node.weight }}>
      <label htmlFor={id}>{str(resolve(node.label))}</label>
      {variant === "longText" ? (
        <textarea rows={2} {...common} />
      ) : (
        <input type={variant === "number" ? "number" : "text"} step="any" {...common} />
      )}
    </div>
  );
}

/** Date picker (A2UI basic DateTimeInput, date only). Empty input removes the value. */
export function DateTimeInput({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<string>(node.value);
  const id = useId();
  return (
    <div className="a2-field" style={{ flexGrow: node.weight }}>
      <label htmlFor={id}>{str(resolve(node.label))}</label>
      <input
        id={id}
        type="date"
        value={value ?? ""}
        min={str(resolve(node.min)) || undefined}
        max={str(resolve(node.max)) || undefined}
        onChange={(e) => {
          setValue(e.target.value || (undefined as unknown as string));
        }}
      />
    </div>
  );
}

export function CheckBox({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<boolean>(node.value);
  return (
    <label className="a2-check" style={{ flexGrow: node.weight }}>
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => {
          setValue(e.target.checked);
        }}
      />
      <span>{str(resolve(node.label))}</span>
    </label>
  );
}

export function Slider({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<number>(node.value);
  const id = useId();
  const min = Number(resolve(node.min) ?? 0);
  const max = Number(resolve(node.max) ?? 100);
  const unit = str(resolve(node.unit));
  const current = value ?? min;
  return (
    <div className="a2-field a2-slider" style={{ flexGrow: node.weight }}>
      <label htmlFor={id}>
        {str(resolve(node.label))}
        <output htmlFor={id}>
          {current.toLocaleString("cs-CZ")}
          {unit && ` ${unit}`}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={Number(resolve(node.steps) ?? 1)}
        value={current}
        onChange={(e) => {
          setValue(Number(e.target.value));
        }}
      />
    </div>
  );
}

type Option = { label: unknown; value: string };

/** Chips. `variant: "single"` behaves like radio buttons, `"multiple"` like checkboxes; value is a string list. */
export function ChoicePicker({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<string[]>(node.value);
  const options = (node.options as Option[] | undefined) ?? [];
  const multiple = node.variant === "multiple";
  const selected = value ?? [];
  const label = str(resolve(node.label));
  return (
    <fieldset className="a2-choices">
      {label && <legend>{label}</legend>}
      <div>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (!multiple) setValue([o.value]);
                else setValue(on ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
              }}
            >
              {str(resolve(o.label))}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
