import { describe, it, expect, vi } from "vitest";
import {
  formatMonthLabel,
  escapeCsvField,
  shortRepoName,
  formatRepoDisplay,
  formatFetchSummary,
  renderTable,
  renderCsv,
  renderJson,
} from "./output.js";
import type { AggregatedData } from "./types.js";
import type { FetchResult } from "./github.js";

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

describe("shortRepoName", () => {
  it("strips org prefix when all repos share the same owner", () => {
    const fn = shortRepoName(["org/api", "org/web", "org/docs"]);
    expect(fn("org/api")).toBe("api");
    expect(fn("org/web")).toBe("web");
  });

  it("keeps full name when repos have different owners", () => {
    const fn = shortRepoName(["org1/api", "org2/web"]);
    expect(fn("org1/api")).toBe("org1/api");
    expect(fn("org2/web")).toBe("org2/web");
  });
});

describe("formatRepoDisplay", () => {
  it("returns single repo name", () => {
    expect(formatRepoDisplay(["org/a"])).toBe("org/a");
  });

  it("joins up to 3 repos with commas", () => {
    expect(formatRepoDisplay(["org/a", "org/b"])).toBe("org/a, org/b");
    expect(formatRepoDisplay(["a/1", "a/2", "a/3"])).toBe("a/1, a/2, a/3");
  });

  it("shows count for more than 3 repos", () => {
    expect(formatRepoDisplay(["a/1", "a/2", "a/3", "a/4"])).toBe(
      "4 repositories",
    );
  });
});

describe("formatFetchSummary", () => {
  const makeResult = (repo: string, count: number, warnings: string[] = []): FetchResult => ({
    repo,
    runs: Array.from({ length: count }, (_, i) => ({
      id: i,
      repo,
      actor: "a",
      workflow: "CI",
      startedAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:01:00Z",
    })),
    warnings,
  });

  it("returns empty string when all repos have zero runs", () => {
    expect(formatFetchSummary([makeResult("org/a", 0)])).toBe("");
  });

  it("formats single repo with runs", () => {
    const summary = formatFetchSummary([makeResult("org/api", 42)]);
    expect(summary).toContain("org/api");
    expect(summary).toContain("42 runs");
  });

  it("aligns columns for multiple repos", () => {
    const results = [
      makeResult("org/api", 10),
      makeResult("org/web-frontend", 200),
    ];
    const lines = formatFetchSummary(results).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("org/api");
    expect(lines[1]).toContain("org/web-frontend");
  });

  it("appends skipped repos count", () => {
    const results = [
      makeResult("org/api", 10),
      makeResult("org/docs", 0),
      makeResult("org/legacy", 0),
    ];
    const summary = formatFetchSummary(results);
    expect(summary).toContain("(2 repos with no runs)");
  });

  it("uses singular for one skipped repo", () => {
    const results = [
      makeResult("org/api", 5),
      makeResult("org/docs", 0),
    ];
    expect(formatFetchSummary(results)).toContain("(1 repo with no runs)");
  });

  it("reports repos with fetch errors", () => {
    const results = [
      makeResult("org/api", 10),
      makeResult("org/broken", 0, ["Failed to fetch"]),
    ];
    const summary = formatFetchSummary(results);
    expect(summary).toContain("(1 repo had fetch errors)");
  });

  it("marks repos with partial data", () => {
    const results = [
      makeResult("org/api", 5, ["Failed to fetch for 2025-02"]),
      makeResult("org/web", 10),
    ];
    const summary = formatFetchSummary(results);
    const apiLine = summary.split("\n").find((l) => l.includes("org/api"))!;
    const webLine = summary.split("\n").find((l) => l.includes("org/web"))!;
    expect(apiLine).toContain("(partial)");
    expect(webLine).not.toContain("(partial)");
  });

  it("handles all repos failing with no runs", () => {
    const results = [
      makeResult("org/a", 0, ["timeout"]),
      makeResult("org/b", 0, ["rate limited"]),
    ];
    const summary = formatFetchSummary(results);
    expect(summary).toContain("(2 repos had fetch errors)");
  });
});

function makeSampleData(multiRepo = false): AggregatedData {
  if (multiRepo) {
    return {
      repos: ["org/api", "org/web"],
      since: "2025-01-01",
      until: "2025-01-31",
      months: ["2025-01"],
      users: [
        {
          actor: "alice",
          repo: "org/api",
          totalMinutes: 60,
          totalRuns: 1,
          monthlyMinutes: { "2025-01": 60 },
          workflows: { CI: { minutes: 60, runs: 1 } },
        },
        {
          actor: "alice",
          repo: "org/web",
          totalMinutes: 30,
          totalRuns: 1,
          monthlyMinutes: { "2025-01": 30 },
          workflows: { CI: { minutes: 30, runs: 1 } },
        },
      ],
      totals: {
        minutes: 90,
        runs: 2,
        monthly: { "2025-01": 90 },
      },
      workflows: [{ name: "CI", minutes: 90, runs: 2 }],
    };
  }

  return {
    repos: ["org/repo"],
    since: "2025-01-01",
    until: "2025-02-28",
    months: ["2025-01", "2025-02"],
    users: [
      {
        actor: "alice",
        repo: "org/repo",
        totalMinutes: 90,
        totalRuns: 2,
        monthlyMinutes: { "2025-01": 60, "2025-02": 30 },
        workflows: { CI: { minutes: 90, runs: 2 } },
      },
      {
        actor: "bob",
        repo: "org/repo",
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

function makeSampleDataWithCommaActor(): AggregatedData {
  return {
    repos: ["org/repo"],
    since: "2025-01-01",
    until: "2025-02-28",
    months: ["2025-01", "2025-02"],
    users: [
      {
        actor: "alice, the dev",
        repo: "org/repo",
        totalMinutes: 90,
        totalRuns: 2,
        monthlyMinutes: { "2025-01": 60, "2025-02": 30 },
        workflows: { CI: { minutes: 90, runs: 2 } },
      },
      {
        actor: "bob",
        repo: "org/repo",
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

describe("renderTable", () => {
  it("renders without Repo column for single repo", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTable(makeSampleData());
    const output = logSpy.mock.calls.map(([c]) => String(c)).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Developer");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("TOTAL");
    expect(output).not.toContain("│ Repo");
  });

  it("renders with Repo column for multi-repo", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderTable(makeSampleData(true));
    const output = logSpy.mock.calls.map(([c]) => String(c)).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Repo");
    expect(output).toContain("api");
    expect(output).toContain("web");
  });
});

describe("renderCsv", () => {
  it("outputs correct CSV to stdout (single repo, no repo column)", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    renderCsv(makeSampleData());

    const output = writeSpy.mock.calls.map(([c]) => c).join("");
    writeSpy.mockRestore();

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("developer,total_minutes,hours,runs,2025-01,2025-02");
    expect(lines[1]).toBe("alice,90,1.5,2,60,30");
    expect(lines[2]).toBe("bob,45,0.8,1,45,0");
    expect(lines[3]).toBe("TOTAL,135,2.3,3,105,30");
  });

  it("includes repo column for multi-repo", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    renderCsv(makeSampleData(true));

    const output = writeSpy.mock.calls.map(([c]) => c).join("");
    writeSpy.mockRestore();

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("developer,repo,total_minutes,hours,runs,2025-01");
    expect(lines[1]).toBe("alice,org/api,60,1.0,1,60");
    expect(lines[2]).toBe("alice,org/web,30,0.5,1,30");
    expect(lines[3]).toBe("TOTAL,,90,1.5,2,90");
  });

  it("escapes actor names with commas", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    renderCsv(makeSampleDataWithCommaActor());

    const output = writeSpy.mock.calls.map(([c]) => c).join("");
    writeSpy.mockRestore();

    expect(output).toContain('"alice, the dev"');
  });
});

describe("renderJson", () => {
  it("outputs valid JSON with correct structure", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    renderJson(makeSampleData());

    const output = logSpy.mock.calls.map(([c]) => c).join("");
    logSpy.mockRestore();

    const parsed = JSON.parse(output);
    expect(parsed.repos).toEqual(["org/repo"]);
    expect(parsed.period).toEqual({ since: "2025-01-01", until: "2025-02-28" });
    expect(parsed.users).toHaveLength(2);
    expect(parsed.users[0].developer).toBe("alice");
    expect(parsed.users[0].repo).toBe("org/repo");
    expect(parsed.users[0].totalMinutes).toBe(90);
    expect(parsed.users[0].monthly).toEqual({ "2025-01": 60, "2025-02": 30 });
    expect(parsed.totals.minutes).toBe(135);
    expect(parsed.workflows).toHaveLength(2);
  });

  it("uses YYYY-MM keys in monthly breakdown", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    renderJson(makeSampleData());

    const output = logSpy.mock.calls.map(([c]) => c).join("");
    logSpy.mockRestore();

    const parsed = JSON.parse(output);
    expect(Object.keys(parsed.users[0].monthly)).toEqual(["2025-01", "2025-02"]);
  });

  it("includes repo per user in multi-repo JSON", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    renderJson(makeSampleData(true));

    const output = logSpy.mock.calls.map(([c]) => c).join("");
    logSpy.mockRestore();

    const parsed = JSON.parse(output);
    expect(parsed.repos).toEqual(["org/api", "org/web"]);
    expect(parsed.users[0].repo).toBe("org/api");
    expect(parsed.users[1].repo).toBe("org/web");
  });
});
