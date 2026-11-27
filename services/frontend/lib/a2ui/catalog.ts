/**
 * JOJO catalog v1: which components the renderer accepts and which props must be data-bound.
 * Prop reference for humans: docs/design/components.md. Renderers: components/a2ui/.
 *
 * Principle "LLM picks the layout, DuckDB supplies the numbers" (docs/design/principles.md §2):
 * every data-bearing prop listed in DATA_PROPS must be `{"@path": …}`, never a literal, so an
 * agent can choose a chart but cannot type the numbers into it.
 */
import { isPathRef, type A2uiError, type ComponentNode } from "./protocol";

export const COMPONENTS = [
  // layout (A2UI basic catalog names)
  "Column",
  "Row",
  "Card",
  "List",
  "Tabs",
  "Collapsible",
  "Divider",
  // content
  "Text",
  "Badge",
  "Callout",
  // inputs (two-way bound)
  "Button",
  "TextField",
  "Slider",
  "ChoicePicker",
  "CheckBox",
  "DateTimeInput",
  // data (custom)
  "Kpi",
  "Table",
  "LineChart",
  "BarChart",
  // story (custom)
  "Steps",
  "StoryTimeline",
  "CurveEditor",
] as const;
export type ComponentName = (typeof COMPONENTS)[number];

export const DATA_PROPS: Partial<Record<ComponentName, readonly string[]>> = {
  Kpi: ["value"],
  Table: ["rows"],
  LineChart: ["data"],
  BarChart: ["data"],
  Steps: ["steps"],
  StoryTimeline: ["points"],
  TextField: ["value"],
  Slider: ["value"],
  ChoicePicker: ["value"],
  CheckBox: ["value"],
  DateTimeInput: ["value"],
  CurveEditor: ["points"],
};

const known = new Set<string>(COMPONENTS);

/** Validation in A2UI error format (`path` points into the updateComponents payload). */
export function validateComponents(surfaceId: string, nodes: ComponentNode[]): A2uiError[] {
  const errors: A2uiError[] = [];
  nodes.forEach((node, i) => {
    if (!known.has(node.component)) {
      errors.push({
        code: "VALIDATION_FAILED",
        surfaceId,
        path: `/components/${String(i)}/component`,
        message: `Unknown component "${node.component}". Valid: ${COMPONENTS.join(", ")}.`,
      });
      return;
    }
    for (const prop of DATA_PROPS[node.component as ComponentName] ?? []) {
      if (!isPathRef(node[prop])) {
        errors.push({
          code: "VALIDATION_FAILED",
          surfaceId,
          path: `/components/${String(i)}/${prop}`,
          message: `${node.component}.${prop} must be a data binding {"@path": "/…"}, not a literal: numbers come from the data model.`,
        });
      }
    }
  });
  return errors;
}

/** Data shape bound to `Steps.steps`. */
export type StepState = "pending" | "running" | "done" | "failed";
export type Step = { id: string; label: string; state: StepState; detail?: string };
