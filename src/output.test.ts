import { describe, it, expect, vi } from "vitest";
import { formatMonthLabel, escapeCsvField, renderCsv, renderJson } from "./output.js";
import type { AggregatedData } from "./types.js";

describe("formatMonthLabel", () => {
  it("converts YYYY-MM to abbreviated month with 2-digit year", () => {
    expect(formatMonthLabel("2025-01")).toBe("Jan 25");
    expect(formatMonthLabel("2026-12")).toBe("Dec 26");
  });

  it("handles all 12 months", () => {
    const expected = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    for (let i = 1; i <= 12; i++) {
      const key = `2025-${String(i).padStart(2, "0")}`;
      expect(formatMonthLabel(key)).toBe(`${expected[i - 1]} 25`);
    }
  });
});

describe("escapeCsvField", () => {
  it("returns plain strings unchanged", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("wraps fields containing commas in quotes", () => {
    expect(escapeCsvField("hello, world")).toBe('"hello, world"');
  });

  it("wraps fields containing double quotes and escapes them", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps fields containing newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps fields containing carriage returns", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("handles combined special characters", () => {
    expect(escapeCsvField('a,b"c\nd')).toBe('"a,b""c\nd"');
  });
});

function makeSampleData(): AggregatedData {
  return {
    repo: "org/repo",
    since: "2025-01-01",
    until: "2025-02-28",
    months: ["2025-01", "2025-02"],
    users: [
      {
        actor: "alice",
        totalMinutes: 90,
        totalRuns: 2,
        monthlyMinutes: { "2025-01": 60, "2025-02": 30 },
        workflows: { CI: { minutes: 90, runs: 2 } },
      },
      {
        actor: "bob",
        totalMinutes: 45,
        totalRuns: 1,
        monthlyMinutes: { "2025-01": 45 },
        workflows: { Deploy: { minutes: 45, runs: 1 } },
      },
    ],
    totals: {
      minutes: 135,
      runs: 3,
      monthly: { "2025-01": 105, "2025-02": 30 },
    },
    workflows: [
      { name: "CI", minutes: 90, runs: 2 },
      { name: "Deploy", minutes: 45, runs: 1 },
    ],
  };
}

describe("renderCsv", () => {
  it("outputs correct CSV to stdout", () => {
    const data = makeSampleData();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    renderCsv(data);

    const output = writeSpy.mock.calls.map(([chunk]) => chunk).join("");
    writeSpy.mockRestore();

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("developer,total_minutes,hours,runs,2025-01,2025-02");
    expect(lines[1]).toBe("alice,90,1.5,2,60,30");
    expect(lines[2]).toBe("bob,45,0.8,1,45,0");
    expect(lines[3]).toBe("TOTAL,135,2.3,3,105,30");
  });

  it("escapes actor names with commas", () => {
    const data = makeSampleData();
    data.users[0].actor = "alice, the dev";
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    renderCsv(data);

    const output = writeSpy.mock.calls.map(([chunk]) => chunk).join("");
    writeSpy.mockRestore();

    expect(output).toContain('"alice, the dev"');
  });
});

describe("renderJson", () => {
  it("outputs valid JSON with correct structure", () => {
    const data = makeSampleData();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    renderJson(data);

    const output = logSpy.mock.calls.map(([chunk]) => chunk).join("");
    logSpy.mockRestore();

    const parsed = JSON.parse(output);
    expect(parsed.repo).toBe("org/repo");
    expect(parsed.period).toEqual({ since: "2025-01-01", until: "2025-02-28" });
    expect(parsed.users).toHaveLength(2);
    expect(parsed.users[0].developer).toBe("alice");
    expect(parsed.users[0].totalMinutes).toBe(90);
    expect(parsed.users[0].monthly).toEqual({ "2025-01": 60, "2025-02": 30 });
    expect(parsed.totals.minutes).toBe(135);
    expect(parsed.workflows).toHaveLength(2);
  });

  it("uses YYYY-MM keys in monthly breakdown", () => {
    const data = makeSampleData();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    renderJson(data);

    const output = logSpy.mock.calls.map(([chunk]) => chunk).join("");
    logSpy.mockRestore();

    const parsed = JSON.parse(output);
    expect(Object.keys(parsed.users[0].monthly)).toEqual(["2025-01", "2025-02"]);
  });
});
