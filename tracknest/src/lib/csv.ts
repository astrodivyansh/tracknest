/**
 * Parses CSV text (RFC 4180: quoted fields, "" escapes, newlines inside quotes).
 * Uses ";" when the header has more of them than commas (Excel in some locales).
 * Returns rows as objects keyed by header; blank lines are skipped. `lines[i]` is the
 * spreadsheet line number where rows[i] starts, so errors point at the right row.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; lines: number[] } {
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const records: { line: number; cells: string[] }[] = [];
  let line = 1;
  let start = 1;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRecord = () => {
    row.push(field);
    records.push({ line: start, cells: row });
    row = [];
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      start = ++line;
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRecord();

  const nonEmpty = records.filter((r) => r.cells.some((v) => v.trim() !== ""));
  const [head, ...body] = nonEmpty;
  const headers = head?.cells.map((h) => h.trim()) ?? [];
  return {
    headers,
    rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r.cells[i] ?? "").trim()]))),
    lines: body.map((r) => r.line),
  };
}

// Quote every cell; prefix formula-like values so Excel won't execute them.
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** A CSV download response; the BOM makes Excel read it as UTF-8 (₹, names in Hindi, etc.). */
export function csvResponse(filename: string, header: string[], rows: unknown[][]) {
  return new Response(toCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** CSV text with a BOM, for downloads and email attachments. */
export const toCsv = (header: string[], rows: unknown[][]) => `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}`;
