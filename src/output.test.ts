import { describe, it, expect } from "vitest";
import {
  formatMonthLabel,
  escapeCsvField,
  shortRepoName,
  formatRepoDisplay,
  formatFetchSummary,
  renderTable,
  renderCsv,
  renderJson,
  renderMarkdown,
  renderPrCostMarkdown,
  renderPrCostJson,
} from "./output.js";
import type { AggregatedData } from "./types.js";
import type { PrCostSummary } from "./billing.js";
import type { FetchResult } from "./github.js";

describe("formatMonthLabel", () => {
  it("converts YYYY-MM to abbreviated month with 2-digit year", () => {
    expect(formatMonthLabel("2025-01")).toBe("Jan 2025");
    expect(formatMonthLabel("2026-12")).toBe("Dec 2026");
  });

  it("handles all 12 months", () => {
    const expected = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    for (let i = 1; i <= 12; i++) {
      const key = `2025-${String(i).padStart(2, "0")}`;
      expect(formatMonthLabel(key)).toBe(`${expected[i - 1]} 2025`);
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
    const output = renderTable(makeSampleData());

    expect(output).toContain("Developer");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("TOTAL");
    expect(output).not.toContain("│ Repo");
  });

  it("renders with Repo column for multi-repo", () => {
    const output = renderTable(makeSampleData(true));

    expect(output).toContain("Repo");
    expect(output).toContain("api");
    expect(output).toContain("web");
  });
});

describe("renderCsv", () => {
  it("outputs correct CSV (single repo, no repo column)", () => {
    const output = renderCsv(makeSampleData());

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("developer,total_minutes,hours,runs,2025-01,2025-02");
    expect(lines[1]).toBe("alice,90,1.5,2,60,30");
    expect(lines[2]).toBe("bob,45,0.8,1,45,0");
    expect(lines[3]).toBe("TOTAL,135,2.3,3,105,30");
  });

  it("includes repo column for multi-repo", () => {
    const output = renderCsv(makeSampleData(true));

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("developer,repo,total_minutes,hours,runs,2025-01");
    expect(lines[1]).toBe("alice,org/api,60,1.0,1,60");
    expect(lines[2]).toBe("alice,org/web,30,0.5,1,30");
    expect(lines[3]).toBe("TOTAL,,90,1.5,2,90");
  });

  it("escapes actor names with commas", () => {
    const output = renderCsv(makeSampleDataWithCommaActor());
    expect(output).toContain('"alice, the dev"');
  });
});

describe("renderMarkdown", () => {
  it("outputs markdown table for single repo", () => {
    const output = renderMarkdown(makeSampleData());

    expect(output).toContain("## GitHub Actions Usage Report");
    expect(output).toContain("**org/repo**");
    expect(output).toContain("| Developer | Minutes | Hours | Runs |");
    expect(output).toContain("| alice |");
    expect(output).toContain("| **TOTAL** |");
    expect(output).not.toContain("| Repo |");
  });

  it("includes Repo column for multi-repo", () => {
    const output = renderMarkdown(makeSampleData(true));

    expect(output).toContain("**2 repositories**");
    expect(output).toContain("| Developer | Repo | Minutes |");
    expect(output).toContain("| alice | api |");
  });

  it("includes workflows in details section", () => {
    const output = renderMarkdown(makeSampleData());

    expect(output).toContain("<details>");
    expect(output).toContain("Top workflows");
    expect(output).toContain("| CI |");
  });
});

describe("renderJson", () => {
  it("outputs valid JSON with correct structure", () => {
    const output = renderJson(makeSampleData());
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
    const output = renderJson(makeSampleData());
    const parsed = JSON.parse(output);
    expect(Object.keys(parsed.users[0].monthly)).toEqual(["2025-01", "2025-02"]);
  });

  it("includes repo per user in multi-repo JSON", () => {
    const output = renderJson(makeSampleData(true));
    const parsed = JSON.parse(output);

    expect(parsed.repos).toEqual(["org/api", "org/web"]);
    expect(parsed.users[0].repo).toBe("org/api");
    expect(parsed.users[1].repo).toBe("org/web");
  });
});

function makeSamplePrCost(): PrCostSummary {
  return {
    pr: 42,
    repo: "org/repo",
    totalCost: 4.2,
    totalBillableMinutes: { UBUNTU: 20, MACOS: 10, WINDOWS: 0 },
    runCount: 3,
    estimated: false,
    workflows: [
      {
        name: "Deploy",
        runs: 1,
        billable: { UBUNTU: 0, MACOS: 10, WINDOWS: 0 },
        cost: 0.8,
      },
      {
        name: "CI",
        runs: 2,
        billable: { UBUNTU: 20, MACOS: 0, WINDOWS: 0 },
        cost: 0.16,
      },
    ],
  };
}

describe("renderPrCostMarkdown", () => {
  it("includes cost header with formatted dollar amount", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("## CI Cost: $4.20");
  });

  it("includes repo and PR info", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("**org/repo**");
    expect(output).toContain("PR #42");
    expect(output).toContain("3 workflow runs");
  });

  it("renders workflow cost table", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("| Workflow | Runs | Linux | macOS | Windows | Cost |");
    expect(output).toContain("| Deploy |");
    expect(output).toContain("| CI |");
    expect(output).toContain("$0.80");
    expect(output).toContain("$0.16");
  });

  it("renders total row", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("| **Total** |");
    expect(output).toContain("**$4.20**");
    expect(output).toContain("**20m**");
    expect(output).toContain("**10m**");
  });

  it("includes disclaimer about published rates", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("published rates");
  });

  it("handles singular run count", () => {
    const summary = { ...makeSamplePrCost(), runCount: 1 };
    const output = renderPrCostMarkdown(summary);
    expect(output).toContain("1 workflow run");
    expect(output).not.toContain("1 workflow runs");
  });
});

describe("renderPrCostJson", () => {
  it("outputs valid JSON with correct structure", () => {
    const output = renderPrCostJson(makeSamplePrCost());
    const parsed = JSON.parse(output);

    expect(parsed.pr).toBe(42);
    expect(parsed.repo).toBe("org/repo");
    expect(parsed.totalCost).toBe(4.2);
    expect(parsed.totalCostFormatted).toBe("$4.20");
    expect(parsed.runCount).toBe(3);
  });

  it("includes billable minutes by OS", () => {
    const output = renderPrCostJson(makeSamplePrCost());
    const parsed = JSON.parse(output);

    expect(parsed.billableMinutes.linux).toBe(20);
    expect(parsed.billableMinutes.macos).toBe(10);
    expect(parsed.billableMinutes.windows).toBe(0);
  });

  it("includes workflow breakdown", () => {
    const output = renderPrCostJson(makeSamplePrCost());
    const parsed = JSON.parse(output);

    expect(parsed.workflows).toHaveLength(2);
    expect(parsed.workflows[0].name).toBe("Deploy");
    expect(parsed.workflows[0].cost).toBe(0.8);
    expect(parsed.workflows[1].name).toBe("CI");
  });

  it("includes estimated flag", () => {
    const output = renderPrCostJson(makeSamplePrCost());
    const parsed = JSON.parse(output);
    expect(parsed.estimated).toBe(false);
  });
});

describe("renderPrCostMarkdown estimated mode", () => {
  function makeEstimatedPrCost(): PrCostSummary {
    return { ...makeSamplePrCost(), estimated: true };
  }

  it("shows 'Estimated CI Cost' header when estimated", () => {
    const output = renderPrCostMarkdown(makeEstimatedPrCost());
    expect(output).toContain("## Estimated CI Cost:");
  });

  it("shows estimated disclaimer when estimated", () => {
    const output = renderPrCostMarkdown(makeEstimatedPrCost());
    expect(output).toContain("Estimated cost based on job durations");
  });

  it("shows standard header when not estimated", () => {
    const output = renderPrCostMarkdown(makeSamplePrCost());
    expect(output).toContain("## CI Cost:");
    expect(output).not.toContain("Estimated CI Cost");
  });
});
