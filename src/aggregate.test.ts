import { describe, it, expect } from "vitest";
import { getMonthKey, getDurationMinutes, aggregate, compareUsers, computeTotals } from "./aggregate.js";
import type { WorkflowRun, UserStats } from "./types.js";

describe("getMonthKey", () => {
  it("returns YYYY-MM format", () => {
    expect(getMonthKey("2025-03-15T10:00:00Z")).toBe("2025-03");
    expect(getMonthKey("2026-12-01T00:00:00Z")).toBe("2026-12");
  });

  it("zero-pads single-digit months", () => {
    expect(getMonthKey("2025-01-05T00:00:00Z")).toBe("2025-01");
  });

  it("differentiates same month across years", () => {
    expect(getMonthKey("2025-01-01T00:00:00Z")).not.toBe(
      getMonthKey("2026-01-01T00:00:00Z"),
    );
  });
});

describe("getDurationMinutes", () => {
  it("calculates duration between two timestamps", () => {
    const result = getDurationMinutes(
      "2025-03-15T10:00:00Z",
      "2025-03-15T10:30:00Z",
    );
    expect(result).toBe(30);
  });

  it("returns 0 for equal timestamps", () => {
    expect(
      getDurationMinutes("2025-03-15T10:00:00Z", "2025-03-15T10:00:00Z"),
    ).toBe(0);
  });

  it("clamps negative durations to 0", () => {
    expect(
      getDurationMinutes("2025-03-15T11:00:00Z", "2025-03-15T10:00:00Z"),
    ).toBe(0);
  });

  it("handles fractional minutes", () => {
    const result = getDurationMinutes(
      "2025-03-15T10:00:00Z",
      "2025-03-15T10:01:30Z",
    );
    expect(result).toBe(1.5);
  });
});

describe("compareUsers", () => {
  const makeUser = (actor: string, repo: string, minutes: number, runs: number): UserStats => ({
    actor,
    repo,
    totalMinutes: minutes,
    totalRuns: runs,
    monthlyMinutes: {},
    workflows: {},
  });

  it("sorts by minutes descending with actor tiebreak", () => {
    const cmp = compareUsers("minutes");
    const a = makeUser("alice", "org/repo", 100, 1);
    const b = makeUser("bob", "org/repo", 50, 1);
    expect(cmp(a, b)).toBeLessThan(0);
  });

  it("sorts by name with repo tiebreak", () => {
    const cmp = compareUsers("name");
    const a = makeUser("alice", "org/api", 0, 0);
    const b = makeUser("alice", "org/web", 0, 0);
    expect(cmp(a, b)).toBeLessThan(0);
  });

  it("sorts by runs descending", () => {
    const cmp = compareUsers("runs");
    const a = makeUser("alice", "org/repo", 0, 10);
    const b = makeUser("bob", "org/repo", 0, 5);
    expect(cmp(a, b)).toBeLessThan(0);
  });
});

describe("computeTotals", () => {
  it("sums minutes, runs, and monthly across users", () => {
    const users: UserStats[] = [
      { actor: "a", repo: "r", totalMinutes: 60, totalRuns: 2, monthlyMinutes: { "2025-01": 60 }, workflows: {} },
      { actor: "b", repo: "r", totalMinutes: 40, totalRuns: 1, monthlyMinutes: { "2025-01": 40 }, workflows: {} },
    ];
    const totals = computeTotals(users, ["2025-01"]);
    expect(totals.minutes).toBe(100);
    expect(totals.runs).toBe(3);
    expect(totals.monthly["2025-01"]).toBe(100);
  });
});

describe("aggregate", () => {
  let nextId = 1;
  const makeRun = (
    actor: string,
    workflow: string,
    startedAt: string,
    minutes: number,
    repo = "org/repo",
  ): WorkflowRun => ({
    id: nextId++,
    repo,
    actor,
    workflow,
    startedAt,
    updatedAt: new Date(
      new Date(startedAt).getTime() + minutes * 60_000,
    ).toISOString(),
  });

  const runs: WorkflowRun[] = [
    makeRun("alice", "CI", "2025-01-10T10:00:00Z", 60),
    makeRun("alice", "CI", "2025-02-05T10:00:00Z", 30),
    makeRun("bob", "Deploy", "2025-01-15T12:00:00Z", 45),
    makeRun("dependabot[bot]", "npm_and_yarn", "2025-01-20T08:00:00Z", 10),
  ];

  it("groups runs by actor and repo", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    const actors = data.users.map((u) => u.actor);
    expect(actors).toContain("alice");
    expect(actors).toContain("bob");
    expect(actors).toContain("dependabot[bot]");
    expect(data.users.every((u) => u.repo === "org/repo")).toBe(true);
  });

  it("calculates per-user totals", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.totalMinutes).toBe(90);
    expect(alice.totalRuns).toBe(2);
  });

  it("tracks monthly breakdown with YYYY-MM keys", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.monthlyMinutes["2025-01"]).toBe(60);
    expect(alice.monthlyMinutes["2025-02"]).toBe(30);
  });

  it("sorts months chronologically", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    expect(data.months).toEqual(["2025-01", "2025-02"]);
  });

  it("preserves individual workflow names in summary", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    const wfNames = data.workflows.map((w) => w.name);
    expect(wfNames).toContain("npm_and_yarn");
    expect(wfNames).toContain("CI");
    expect(wfNames).toContain("Deploy");
  });

  it("sorts by minutes descending by default", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    expect(data.users[0].actor).toBe("alice");
  });

  it("sorts by name alphabetically", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "name");
    const actors = data.users.map((u) => u.actor);
    expect(actors).toEqual([...actors].sort());
  });

  it("sorts by runs descending", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "runs");
    for (let i = 1; i < data.users.length; i++) {
      expect(data.users[i - 1].totalRuns).toBeGreaterThanOrEqual(
        data.users[i].totalRuns,
      );
    }
  });

  it("handles cross-year data without collision", () => {
    const crossYearRuns: WorkflowRun[] = [
      makeRun("alice", "CI", "2025-01-10T10:00:00Z", 60),
      makeRun("alice", "CI", "2026-01-10T10:00:00Z", 120),
    ];
    const data = aggregate(
      crossYearRuns, ["org/repo"], "2025-01-01", "2026-01-31", "minutes",
    );
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.monthlyMinutes["2025-01"]).toBe(60);
    expect(alice.monthlyMinutes["2026-01"]).toBe(120);
    expect(data.months).toEqual(["2025-01", "2026-01"]);
  });

  it("computes correct totals", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    expect(data.totals.runs).toBe(4);
    expect(data.totals.minutes).toBe(60 + 30 + 45 + 10);
    expect(data.totals.monthly["2025-01"]).toBe(60 + 45 + 10);
    expect(data.totals.monthly["2025-02"]).toBe(30);
  });

  it("creates separate entries for same actor across repos", () => {
    const multiRepoRuns: WorkflowRun[] = [
      makeRun("alice", "CI", "2025-01-10T10:00:00Z", 60, "org/api"),
      makeRun("alice", "CI", "2025-01-10T10:00:00Z", 30, "org/web"),
    ];
    const data = aggregate(
      multiRepoRuns, ["org/api", "org/web"], "2025-01-01", "2025-01-31", "minutes",
    );
    const aliceEntries = data.users.filter((u) => u.actor === "alice");
    expect(aliceEntries).toHaveLength(2);
    expect(aliceEntries.map((u) => u.repo).sort()).toEqual(["org/api", "org/web"]);
    expect(aliceEntries.find((u) => u.repo === "org/api")!.totalMinutes).toBe(60);
    expect(aliceEntries.find((u) => u.repo === "org/web")!.totalMinutes).toBe(30);
  });

  it("stores repos array in output", () => {
    const data = aggregate(runs, ["org/repo"], "2025-01-01", "2025-02-28", "minutes");
    expect(data.repos).toEqual(["org/repo"]);
  });
});
