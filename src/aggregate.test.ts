import { describe, it, expect } from "vitest";
import { getMonthKey, getDurationMinutes, aggregate } from "./aggregate.js";
import type { WorkflowRun } from "./types.js";

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

describe("aggregate", () => {
  let nextId = 1;
  const makeRun = (
    actor: string,
    workflow: string,
    startedAt: string,
    minutes: number,
  ): WorkflowRun => ({
    id: nextId++,
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

  it("groups runs by actor", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    const actors = data.users.map((u) => u.actor);
    expect(actors).toContain("alice");
    expect(actors).toContain("bob");
    expect(actors).toContain("dependabot[bot]");
  });

  it("calculates per-user totals", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.totalMinutes).toBe(90);
    expect(alice.totalRuns).toBe(2);
  });

  it("tracks monthly breakdown with YYYY-MM keys", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.monthlyMinutes["2025-01"]).toBe(60);
    expect(alice.monthlyMinutes["2025-02"]).toBe(30);
  });

  it("sorts months chronologically", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    expect(data.months).toEqual(["2025-01", "2025-02"]);
  });

  it("preserves individual workflow names in summary", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    const wfNames = data.workflows.map((w) => w.name);
    expect(wfNames).toContain("npm_and_yarn");
    expect(wfNames).toContain("CI");
    expect(wfNames).toContain("Deploy");
  });

  it("sorts by minutes descending by default", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    expect(data.users[0].actor).toBe("alice");
  });

  it("sorts by name alphabetically", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "name");
    const actors = data.users.map((u) => u.actor);
    expect(actors).toEqual([...actors].sort());
  });

  it("sorts by runs descending", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "runs");
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
      crossYearRuns, "org/repo", "2025-01-01", "2026-01-31", "minutes",
    );
    const alice = data.users.find((u) => u.actor === "alice")!;
    expect(alice.monthlyMinutes["2025-01"]).toBe(60);
    expect(alice.monthlyMinutes["2026-01"]).toBe(120);
    expect(data.months).toEqual(["2025-01", "2026-01"]);
  });

  it("computes correct totals", () => {
    const data = aggregate(runs, "org/repo", "2025-01-01", "2025-02-28", "minutes");
    expect(data.totals.runs).toBe(4);
    expect(data.totals.minutes).toBe(60 + 30 + 45 + 10);
    expect(data.totals.monthly["2025-01"]).toBe(60 + 45 + 10);
    expect(data.totals.monthly["2025-02"]).toBe(30);
  });
});
