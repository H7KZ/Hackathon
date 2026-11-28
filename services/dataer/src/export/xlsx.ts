/**
 * Minimal xlsx (Office Open XML) writer: one sheet per table, header row, inline strings, numbers as
 * numbers. No styles, no shared strings: Excel, LibreOffice and pandas open it.
 */
import type { Row } from "@s2d/schema/run";
import { zip } from "./zip";

export type Sheet = { name: string; columns: string[]; numeric: Set<string>; rows: Row[] };

/** Excel's sheet limit; longer tables are cut (the CSV / Parquet exports have every row). */
export const XLSX_MAX_ROWS = 1_048_575;

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    // XML 1.0 forbids control characters other than tab, newline and carriage return
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32 || ch === "\t" || ch === "\n" || ch === "\r")
    .join("");

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cell(ref: string, value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return "";
  if (numeric || typeof value === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return `<c r="${ref}"><v>${String(n)}</v></c>`;
  }
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml(s: Sheet): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  ];
  const header = s.columns.map((c, i) => cell(`${columnName(i)}1`, c, false)).join("");
  out.push(`<row r="1">${header}</row>`);
  s.rows.slice(0, XLSX_MAX_ROWS).forEach((row, r) => {
    const n = r + 2;
    const cells = s.columns.map((c, i) => cell(`${columnName(i)}${String(n)}`, row[c], s.numeric.has(c)));
    out.push(`<row r="${String(n)}">${cells.join("")}</row>`);
  });
  out.push("</sheetData></worksheet>");
  return out.join("");
}

/** Excel sheet names: ≤ 31 chars, no []:*?/\, unique. */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = raw.replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "sheet";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)}_${String(i)}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function xlsx(sheets: Sheet[]): Buffer {
  const names = sheetNames(sheets.map((s) => s.name));
  const b = (s: string) => Buffer.from(s, "utf8");
  const ids = sheets.map((_, i) => String(i + 1));
  return zip([
    {
      name: "[Content_Types].xml",
      data: b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          ids
            .map(
              (i) =>
                `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          "</Types>",
      ),
    },
    {
      name: "_rels/.rels",
      data: b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: "xl/workbook.xml",
      data: b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          names
            .map((n, i) => `<sheet name="${esc(n)}" sheetId="${ids[i] ?? ""}" r:id="rId${ids[i] ?? ""}"/>`)
            .join("") +
          "</sheets></workbook>",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          ids
            .map(
              (i) =>
                `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`,
            )
            .join("") +
          "</Relationships>",
      ),
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${String(i + 1)}.xml`, data: b(sheetXml(s)) })),
  ]);
}
