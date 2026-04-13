import { describe, it, expect } from "vitest";
import {
  calculateRunCost,
  aggregatePrCost,
  formatDollar,
  GITHUB_RATES,
  RUNNER_OS_KEYS,
} from "./billing.js";
import type { RunTiming } from "./billing.js";
import type { WorkflowRun } from "./types.js";

describe("formatDollar", () => {
  it("formats zero", () => {
    expect(formatDollar(0)).toBe("$0.00");
  });

  it("formats whole dollars", () => {
    expect(formatDollar(4)).toBe("$4.00");
  });

  it("formats cents", () => {
    expect(formatDollar(4.2)).toBe("$4.20");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatDollar(1.999)).toBe("$2.00");
    expect(formatDollar(0.001)).toBe("$0.00");
  });
});

describe("calculateRunCost", () => {
  it("returns 0 for zero billable minutes", () => {
    expect(calculateRunCost({ UBUNTU: 0, MACOS: 0, WINDOWS: 0 })).toBe(0);
  });

  it("applies Linux rate correctly", () => {
    const cost = calculateRunCost({ UBUNTU: 10, MACOS: 0, WINDOWS: 0 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.UBUNTU);
  });

  it("applies macOS rate correctly", () => {
    const cost = calculateRunCost({ UBUNTU: 0, MACOS: 10, WINDOWS: 0 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.MACOS);
  });

  it("applies Windows rate correctly", () => {
    const cost = calculateRunCost({ UBUNTU: 0, MACOS: 0, WINDOWS: 10 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.WINDOWS);
  });

  it("sums costs across all OS types", () => {
    const cost = calculateRunCost({ UBUNTU: 10, MACOS: 5, WINDOWS: 8 });
    const expected =
      10 * GITHUB_RATES.UBUNTU +
      5 * GITHUB_RATES.MACOS +
      8 * GITHUB_RATES.WINDOWS;
    expect(cost).toBeCloseTo(expected);
  });
});

describe("aggregatePrCost", () => {
  const makeRun = (id: number, workflow: string): WorkflowRun => ({
    id,
    repo: "org/repo",
    actor: "dev",
    workflow,
    startedAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:10:00Z",
  });

  const makeTiming = (
    runId: number,
    workflow: string,
    billable: { UBUNTU: number; MACOS: number; WINDOWS: number },
  ): RunTiming => ({
    runId,
    workflow,
    billable,
    durationMs: 600_000,
  });

  it("aggregates a single run", () => {
    const runs = [makeRun(1, "CI")];
    const timings = [makeTiming(1, "CI", { UBUNTU: 5, MACOS: 0, WINDOWS: 0 })];
    const summary = aggregatePrCost(timings, runs, 42, "org/repo");

    expect(summary.pr).toBe(42);
    expect(summary.repo).toBe("org/repo");
    expect(summary.runCount).toBe(1);
    expect(summary.totalCost).toBeCloseTo(5 * GITHUB_RATES.UBUNTU);
    expect(summary.totalBillableMinutes.UBUNTU).toBe(5);
    expect(summary.workflows).toHaveLength(1);
    expect(summary.workflows[0].name).toBe("CI");
    expect(summary.workflows[0].runs).toBe(1);
  });

  it("aggregates multiple runs of the same workflow", () => {
    const runs = [makeRun(1, "CI"), makeRun(2, "CI")];
    const timings = [
      makeTiming(1, "CI", { UBUNTU: 5, MACOS: 0, WINDOWS: 0 }),
      makeTiming(2, "CI", { UBUNTU: 3, MACOS: 0, WINDOWS: 0 }),
    ];
    const summary = aggregatePrCost(timings, runs, 42, "org/repo");

    expect(summary.runCount).toBe(2);
    expect(summary.totalBillableMinutes.UBUNTU).toBe(8);
    expect(summary.workflows).toHaveLength(1);
    expect(summary.workflows[0].runs).toBe(2);
  });

  it("aggregates multiple workflows sorted by cost descending", () => {
    const runs = [makeRun(1, "CI"), makeRun(2, "Deploy")];
    const timings = [
      makeTiming(1, "CI", { UBUNTU: 2, MACOS: 0, WINDOWS: 0 }),
      makeTiming(2, "Deploy", { UBUNTU: 0, MACOS: 10, WINDOWS: 0 }),
    ];
    const summary = aggregatePrCost(timings, runs, 7, "org/repo");

    expect(summary.workflows).toHaveLength(2);
    // Deploy (macOS) should be more expensive than CI (Linux)
    expect(summary.workflows[0].name).toBe("Deploy");
    expect(summary.workflows[1].name).toBe("CI");
  });

  it("handles empty timings", () => {
    const summary = aggregatePrCost([], [], 1, "org/repo");

    expect(summary.runCount).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.workflows).toHaveLength(0);
    for (const os of RUNNER_OS_KEYS) {
      expect(summary.totalBillableMinutes[os]).toBe(0);
    }
  });
});
