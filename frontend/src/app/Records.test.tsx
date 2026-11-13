import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Obligation } from "../api/fiscal.api";
import { AccountScreen, ConfirmDialog, ObligationCalendar, parseAmountCell, parseMonthCell, parseMonthlyImport } from "./Records";

describe("parseMonthCell", () => {
  it.each([
    ["2025-03", "2025-03"],
    ["2025/3", "2025-03"],
    ["2025-03-15", "2025-03"],
    ["03/2025", "2025-03"],
    ["15/03/2025", "2025-03"],
    ["mar 2025", "2025-03"],
    ["Marzo de 2025", "2025-03"],
    ["mar-25", "2025-03"],
    ["sept. 2024", "2024-09"],
    ["2025 diciembre", "2025-12"],
  ])("reads %s", (raw, expected) => {
    expect(parseMonthCell(raw)).toBe(expected);
  });

  it.each(["Mes", "13/2025", "2025-00", "foo 2025", "", "1999-05"])("rejects '%s'", (raw) => {
    expect(parseMonthCell(raw)).toBeNull();
  });
});

describe("parseAmountCell", () => {
  it.each([
    ["52500000", "52500000.00"],
    ["52.500.000", "52500000.00"],
    ["52,500,000.50", "52500000.50"],
    ["$ 52.500.000,5", "52500000.50"],
    ["1.500", "1500.00"],
    ["1,5", "1.50"],
    ["1500.75", "1500.75"],
    ["COP 2.000", "2000.00"],
    ["", "0.00"],
    ["-", "0.00"],
  ])("reads '%s'", (raw, expected) => {
    expect(parseAmountCell(raw)).toBe(expected);
  });

  it.each(["abc", "-500", "12a"])("rejects %s", (raw) => {
    expect(parseAmountCell(raw)).toBeNull();
  });
});

describe("parseMonthlyImport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads a CSV with a header and sorts the months", () => {
    const result = parseMonthlyImport("Mes;Ingresos;Gastos\n2026-02;52.500.000;40.000.000\n2026-01;48.000.000;39.500.000\n");
    expect(result.problems).toEqual([]);
    expect(result.months).toEqual([
      { month: "2026-01", income: "48000000.00", expenses: "39500000.00" },
      { month: "2026-02", income: "52500000.00", expenses: "40000000.00" },
    ]);
  });

  it("reads cells pasted from a spreadsheet and quoted amounts with commas", () => {
    expect(parseMonthlyImport("ene 2026\t1.000\t500").months).toEqual([{ month: "2026-01", income: "1000.00", expenses: "500.00" }]);
    expect(parseMonthlyImport('2026-01,"1,000,000.00","250,000.00"').months).toEqual([
      { month: "2026-01", income: "1000000.00", expenses: "250000.00" },
    ]);
  });

  it("skips the current month and later ones", () => {
    const result = parseMonthlyImport("2026-05;10;5\n2026-06;10;5\n2026-07;10;5");
    expect(result.months.map((item) => item.month)).toEqual(["2026-05"]);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain("2026-06 has not closed yet");
  });

  it("keeps the last row of a repeated month and says so", () => {
    const result = parseMonthlyImport("2026-01;10;5\n2026-01;20;7");
    expect(result.months).toEqual([{ month: "2026-01", income: "20.00", expenses: "7.00" }]);
    expect(result.problems).toEqual(["Row 2: 2026-01 is repeated; the last row is used."]);
  });

  it("reports the rows it cannot use", () => {
    const result = parseMonthlyImport("Mes;Ingresos;Gastos\nfoo;1;2\n2026-01;10\n2026-02;x;5");
    expect(result.months).toEqual([]);
    expect(result.problems).toEqual([
      'Row 2: "foo" is not a month.',
      "Row 3: three columns are needed (month, income, expenses).",
      "Row 4: the amounts of 2026-02 are not valid numbers.",
    ]);
  });

  it("explains an empty file and a file with only a header", () => {
    expect(parseMonthlyImport("\n\n").problems).toEqual(["The file is empty."]);
    expect(parseMonthlyImport("Mes;Ingresos;Gastos").problems).toEqual(["No rows with a month were found."]);
  });
});

describe("ConfirmDialog", () => {
  it("asks before deleting and reports each choice", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete this income record?" detail="FV-12 · $ 500" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("Delete this income record?")).toBeTruthy();
    expect(screen.getByText("FV-12 · $ 500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks both buttons while the deletion runs and shows the error", () => {
    render(<ConfirmDialog title="Delete?" detail="x" busy error="It has payments" onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("It has payments")).toBeTruthy();
  });
});

const obligation = (id: number, name: string, due_date: string, status: string): Obligation =>
  ({ id, name, period: "", due_date, status, estimated_amount: null, notes: "" }) as unknown as Obligation;

describe("ObligationCalendar", () => {
  const rows = [
    obligation(1, "IVA bimestre 1", "2026-03-10", "pending"),
    obligation(2, "Retención abril", "2026-05-12", "paid"),
    obligation(3, "Renta 2026", "2027-04-20", "pending"),
  ];

  it("marks a pending obligation whose date has passed as overdue", () => {
    render(<ObligationCalendar rows={rows} today="2026-04-01" />);
    expect(screen.getByText("IVA bimestre 1")).toBeTruthy();
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.queryByText("Renta 2026")).toBeNull();
  });

  it("changes year from the selector", () => {
    render(<ObligationCalendar rows={rows} today="2026-04-01" />);
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2027" } });
    expect(screen.getByText("Renta 2026")).toBeTruthy();
    expect(screen.queryByText("IVA bimestre 1")).toBeNull();
    expect(screen.queryByText("Overdue")).toBeNull();
  });
});

describe("AccountScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not offer the password change in the demo session", () => {
    const { container } = render(<AccountScreen userName="Ana" userEmail="ana@example.com" demoMode />);
    expect(screen.getByText("The password cannot be changed in the demo session.")).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();
  });

  it("checks the new password before calling the server", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AccountScreen userName="Ana" userEmail="ana@example.com" demoMode={false} />);
    const [current, next, repeat] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    const form = container.querySelector("form")!;

    fireEvent.change(current, { target: { value: "old-password-1" } });
    fireEvent.change(next, { target: { value: "short" } });
    fireEvent.change(repeat, { target: { value: "short" } });
    fireEvent.submit(form);
    expect(screen.getByText("The new password must have at least 10 characters.")).toBeTruthy();

    fireEvent.change(next, { target: { value: "long-enough-password" } });
    fireEvent.change(repeat, { target: { value: "another-long-password" } });
    fireEvent.submit(form);
    expect(screen.getByText("The two new passwords do not match.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
