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

export function TextField({ node }: NodeProps) {
  const resolve = useResolve();
  const [value, setValue] = useBinding<string>(node.value);
  const id = useId();
  const common = {
    id,
    value: value ?? "",
    placeholder: str(resolve(node.placeholder)),
    onChange: (e: { target: { value: string } }) => {
      setValue(e.target.value);
    },
  };
  return (
    <div className="a2-field">
      <label htmlFor={id}>{str(resolve(node.label))}</label>
      {node.multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
    </div>
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
    <div className="a2-field a2-slider">
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
