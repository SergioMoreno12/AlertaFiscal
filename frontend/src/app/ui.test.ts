import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { alertStatusUi, obligationStatusLabel, toMoneyString } from "./shared";
import { errorMessage, fmt, fmtDate, num, roleLabel, shortMonth } from "./ui";

describe("formatting helpers", () => {
  it("num turns anything that is not a number into 0", () => {
    expect(num("1250.50")).toBe(1250.5);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0);
  });

  it("fmt writes pesos without decimals", () => {
    expect(fmt(1500000)).toContain("1,500,000");
    expect(fmt(1500000)).not.toContain(".");
  });

  it("fmtDate reads a date without moving it to another day", () => {
    expect(fmtDate("2026-03-01")).toBe("Mar 01, 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });

  it("shortMonth names the month of a period", () => {
    expect(shortMonth("2026-01")).toBe("Jan");
    expect(shortMonth("x")).toBe("x");
  });

  it("roleLabel keeps an unknown role as it comes", () => {
    expect(roleLabel("contador")).toBe("Accountant");
    expect(roleLabel("other")).toBe("other");
  });

  it("errorMessage shows the server message only for API errors", () => {
    expect(errorMessage(new ApiError(409, "nit_taken", "That NIT is already registered"))).toBe("That NIT is already registered");
    expect(errorMessage(new Error("boom"))).toBe("The operation could not be completed.");
  });
});

describe("shared helpers", () => {
  it("toMoneyString accepts a comma as decimal mark and rejects negatives", () => {
    expect(toMoneyString("1500,5")).toBe("1500.50");
    expect(toMoneyString(" 2 000 ")).toBe("2000.00");
    expect(toMoneyString("-5")).toBe("0.00");
    expect(toMoneyString("abc")).toBe("0.00");
  });

  it("maps the statuses the API sends", () => {
    expect(alertStatusUi("reviewed")).toBe("revisada");
    expect(alertStatusUi("in_review")).toBe("en-revision");
    expect(alertStatusUi("open")).toBe("pendiente");
    expect(obligationStatusLabel("filed")).toBe("Filed");
    expect(obligationStatusLabel("custom")).toBe("custom");
  });
});
