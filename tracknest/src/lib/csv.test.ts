import { describe, expect, it } from "vitest";
import { csvResponse, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, embedded newlines, CRLF and blank lines", () => {
    const text = '﻿name,notes\r\n"Dell, Latitude","said ""hi""\nline 2"\r\n\r\nChair,\r\n';
    expect(parseCsv(text)).toEqual({
      headers: ["name", "notes"],
      rows: [
        { name: "Dell, Latitude", notes: 'said "hi"\nline 2' },
        { name: "Chair", notes: "" },
      ],
      lines: [2, 5], // line 4 is blank; the quoted newline spans lines 2–3
    });
  });

  it("detects semicolon-separated files and fills missing cells", () => {
    expect(parseCsv("name;cost\nDesk;1,5\nLamp").rows).toEqual([
      { name: "Desk", cost: "1,5" },
      { name: "Lamp", cost: "" },
    ]);
  });
});

describe("csvResponse", () => {
  it("quotes cells, neutralises formulas and round-trips through parseCsv", async () => {
    const res = csvResponse("x.csv", ["a", "b"], [['=HYPERLINK("x")', 'say "hi", ok'], [null, 5]]);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const text = new TextDecoder().decode(bytes);
    expect(parseCsv(text).rows).toEqual([
      { a: `'=HYPERLINK("x")`, b: 'say "hi", ok' },
      { a: "", b: "5" },
    ]);
  });
});
