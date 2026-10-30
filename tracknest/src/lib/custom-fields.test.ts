import { describe, expect, it } from "vitest";
import { parseCustom, showCustom, type FieldDef } from "./custom-fields";

const f = (o: Partial<FieldDef> & Pick<FieldDef, "id" | "type">): FieldDef => ({ label: o.id, options: [], required: false, categoryId: null, ...o });
const defs = [
  f({ id: "warranty", label: "Warranty expiry", type: "date", required: true }),
  f({ id: "ram", label: "RAM (GB)", type: "number", categoryId: "laptops" }),
  f({ id: "os", label: "OS", type: "select", options: ["Windows", "macOS", "Linux"] }),
  f({ id: "insured", label: "Insured", type: "checkbox" }),
  f({ id: "imei", label: "IMEI", type: "text" }),
];

describe("parseCustom", () => {
  it("normalises each type", () => {
    expect(parseCustom(defs, { warranty: "31/12/2027", ram: "1,024", os: "macos", insured: "on", imei: " 3569 " }, "laptops")).toEqual({
      values: { warranty: "2027-12-31", ram: 1024, os: "macOS", insured: true, imei: "3569" },
      errors: [],
    });
  });

  it("reports required and invalid values", () => {
    expect(parseCustom(defs, { ram: "lots", os: "BeOS", warranty: "" }, "laptops").errors).toEqual([
      "Warranty expiry is required.",
      "RAM (GB) must be a number.",
      "OS must be one of: Windows, macOS, Linux.",
    ]);
    expect(parseCustom(defs, { warranty: "2027-02-30" }, null).errors).toEqual(["Warranty expiry must be a date like 2026-12-31."]);
  });

  it("drops fields that belong to another category and stores unticked boxes as false", () => {
    expect(parseCustom(defs, { warranty: "2027-01-01", ram: "16" }, "chairs").values).toEqual({ warranty: "2027-01-01", insured: false });
  });

  it("formats for display", () => {
    expect(showCustom(defs[0], "2027-12-31")).toBe("31 Dec 2027");
    expect(showCustom(defs[3], false)).toBe("No");
    expect(showCustom(defs[4], undefined)).toBeNull();
  });
});
