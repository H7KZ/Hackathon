/**
 * Entity ids in words a user knows (user feedback: nobody knows what STO-001 means without opening the
 * tables). The API returns the names the engine gives entities (`GET /sessions/:id/labels`); here they
 * replace ids in read-only texts as "Name (STO-001)", so the id still leads to the rows in the data.
 * Editable texts (story point titles) are left alone: they are sent back to the API as written.
 */
import type { CompareView, DatasetView, DetectiveView, ExpectationToggle, Marker } from "./surfaces";

export type Labels = Record<string, string>;

const ENTITY_ID = /\b([A-Z][A-Z0-9]*-\d{3})\b/g;

export function humanizeIds(text: string, labels: Labels): string {
  return text.replace(ENTITY_ID, (id: string, _m: string, at: number) => {
    const label = labels[id];
    if (!label) return id;
    // already "Name (ID)" (a text humanized twice, or written that way by an agent)
    if (text.slice(Math.max(0, at - label.length - 2), at) === `${label} (`) return id;
    if (text.startsWith(` (${label})`, at + id.length)) return id;
    return `${label} (${id})`;
  });
}

const markers = (m: Marker[], labels: Labels) =>
  m.map((x) => ({ ...x, label: humanizeIds(x.label, labels) }));

export function humanizeDataset(v: DatasetView, labels: Labels): DatasetView {
  return {
    ...v,
    markers: markers(v.markers, labels),
    expectations: v.expectations.map((e) => ({ ...e, description: humanizeIds(e.description, labels) })),
  };
}

export function humanizeCompare(v: CompareView, labels: Labels): CompareView {
  return { ...v, markers: markers(v.markers, labels) };
}

export function humanizeDetective(v: DetectiveView, labels: Labels): DetectiveView {
  return {
    ...v,
    narrative: humanizeIds(v.narrative, labels),
    findings: v.findings.map((f) => ({
      ...f,
      claim: humanizeIds(f.claim, labels),
      entities: humanizeIds(f.entities, labels),
    })),
  };
}

export function humanizeToggles(list: ExpectationToggle[], labels: Labels): ExpectationToggle[] {
  return list.map((e) => ({ ...e, description: humanizeIds(e.description, labels) }));
}
