import { describe, it, expect } from "vitest";
import {
  calculateRunCost,
  aggregatePrCost,
  formatDollar,
  classifyRunner,
  rateForLabels,
  zeroBillable,
  GITHUB_RATES,
  RUNNER_CATEGORIES,
} from "./billing.js";
import type { RunTiming, BillableMinutes } from "./billing.js";

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

describe("zeroBillable", () => {
  it("returns all categories at zero", () => {
    const b = zeroBillable();
    for (const cat of RUNNER_CATEGORIES) {
      expect(b[cat]).toBe(0);
    }
  });

  it("returns a fresh object each call", () => {
    const a = zeroBillable();
    const b = zeroBillable();
    a.UBUNTU = 5;
    expect(b.UBUNTU).toBe(0);
  });
});

describe("classifyRunner", () => {
  it("maps ubuntu-latest to UBUNTU", () => {
    expect(classifyRunner(["ubuntu-latest"])).toBe("UBUNTU");
  });

  it("maps ubuntu-latest-16-cores to UBUNTU", () => {
    expect(classifyRunner(["ubuntu-latest-16-cores"])).toBe("UBUNTU");
  });

  it("maps macos-latest to MACOS", () => {
    expect(classifyRunner(["macos-latest"])).toBe("MACOS");
  });

  it("maps macos-26 to MACOS", () => {
    expect(classifyRunner(["macos-26"])).toBe("MACOS");
  });

  it("maps windows-latest to WINDOWS", () => {
    expect(classifyRunner(["windows-latest"])).toBe("WINDOWS");
  });

  it("maps windows-2022 to WINDOWS", () => {
    expect(classifyRunner(["windows-2022"])).toBe("WINDOWS");
  });

  it("maps mac and mac- prefixed labels to MACOS", () => {
    expect(classifyRunner(["mac"])).toBe("MACOS");
    expect(classifyRunner(["mac-latest"])).toBe("MACOS");
    expect(classifyRunner(["mac-13"])).toBe("MACOS");
  });

  it("does not false-positive on labels containing 'mac' as substring", () => {
    expect(classifyRunner(["my-macmini-builder"])).toBe("UBUNTU");
    expect(classifyRunner(["attack-vector"])).toBe("UBUNTU");
    expect(classifyRunner(["macmini"])).toBe("UBUNTU");
  });

  it("defaults to UBUNTU for unrecognized labels", () => {
    expect(classifyRunner(["my-org-runner"])).toBe("UBUNTU");
  });

  it("defaults to UBUNTU for empty labels", () => {
    expect(classifyRunner([])).toBe("UBUNTU");
  });

  it("first recognized label wins when multiple OS labels present", () => {
    expect(classifyRunner(["linux", "windows"])).toBe("UBUNTU");
    expect(classifyRunner(["windows", "linux"])).toBe("WINDOWS");
  });

  it("detects self-hosted before OS", () => {
    expect(classifyRunner(["self-hosted", "linux", "x64"])).toBe("SELF_HOSTED");
    expect(classifyRunner(["self-hosted", "windows", "x64"])).toBe("SELF_HOSTED");
    expect(classifyRunner(["self-hosted", "macOS", "arm64"])).toBe("SELF_HOSTED");
  });

  it("detects self-hosted regardless of label position", () => {
    expect(classifyRunner(["linux", "self-hosted"])).toBe("SELF_HOSTED");
    expect(classifyRunner(["x64", "self-hosted", "gpu"])).toBe("SELF_HOSTED");
  });

  it("detects self-hosted case-insensitively", () => {
    expect(classifyRunner(["Self-Hosted", "linux"])).toBe("SELF_HOSTED");
    expect(classifyRunner(["SELF-HOSTED"])).toBe("SELF_HOSTED");
  });

  it("does not false-positive on labels containing 'self-hosted' as substring", () => {
    expect(classifyRunner(["not-self-hosted-runner"])).toBe("UBUNTU");
    expect(classifyRunner(["self-hosted-like"])).toBe("UBUNTU");
  });
});

describe("rateForLabels", () => {
  it("returns standard Linux rate for ubuntu-latest", () => {
    expect(rateForLabels(["ubuntu-latest"])).toBe(GITHUB_RATES.UBUNTU);
  });

  it("returns standard macOS rate for macos-latest", () => {
    expect(rateForLabels(["macos-latest"])).toBe(GITHUB_RATES.MACOS);
  });

  it("returns standard Windows rate for windows-latest", () => {
    expect(rateForLabels(["windows-latest"])).toBe(GITHUB_RATES.WINDOWS);
  });

  it("returns 0 for self-hosted by default", () => {
    expect(rateForLabels(["self-hosted", "linux"])).toBe(0);
  });

  it("returns custom rate for self-hosted", () => {
    expect(rateForLabels(["self-hosted", "linux"], 0.01)).toBe(0.01);
  });

  it("scales Linux rate by core count", () => {
    // 4-core = 2x base rate
    expect(rateForLabels(["ubuntu-latest-4-cores"])).toBeCloseTo(GITHUB_RATES.UBUNTU * 2);
    // 8-core = 4x
    expect(rateForLabels(["ubuntu-latest-8-cores"])).toBeCloseTo(GITHUB_RATES.UBUNTU * 4);
    // 16-core = 8x
    expect(rateForLabels(["ubuntu-latest-16-cores"])).toBeCloseTo(GITHUB_RATES.UBUNTU * 8);
    // 64-core = 32x
    expect(rateForLabels(["ubuntu-latest-64-cores"])).toBeCloseTo(GITHUB_RATES.UBUNTU * 32);
  });

  it("scales Windows rate by core count", () => {
    expect(rateForLabels(["windows-latest-8-cores"])).toBeCloseTo(GITHUB_RATES.WINDOWS * 4);
  });

  it("returns macOS large rate for macos-large labels", () => {
    expect(rateForLabels(["macos-large"])).toBe(0.12);
    expect(rateForLabels(["macos-latest-large"])).toBe(0.12);
  });

  it("returns macOS xlarge rate for macos-xlarge labels", () => {
    expect(rateForLabels(["macos-latest-xlarge"])).toBe(0.16);
    expect(rateForLabels(["macos-13-xlarge"])).toBe(0.16);
  });

  it("prefers self-hosted over larger runner detection", () => {
    expect(rateForLabels(["self-hosted", "ubuntu-latest-16-cores"], 0.05)).toBe(0.05);
  });

  it("returns standard rate for unrecognized labels", () => {
    expect(rateForLabels(["my-custom-runner"])).toBe(GITHUB_RATES.UBUNTU);
  });
});

describe("calculateRunCost", () => {
  const zero: BillableMinutes = { UBUNTU: 0, MACOS: 0, WINDOWS: 0, SELF_HOSTED: 0 };

  it("returns 0 for zero billable minutes", () => {
    expect(calculateRunCost(zero)).toBe(0);
  });

  it("applies Linux rate correctly", () => {
    const cost = calculateRunCost({ ...zero, UBUNTU: 10 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.UBUNTU);
  });

  it("applies macOS rate correctly", () => {
    const cost = calculateRunCost({ ...zero, MACOS: 10 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.MACOS);
  });

  it("applies Windows rate correctly", () => {
    const cost = calculateRunCost({ ...zero, WINDOWS: 10 });
    expect(cost).toBeCloseTo(10 * GITHUB_RATES.WINDOWS);
  });

  it("self-hosted contributes zero cost", () => {
    const cost = calculateRunCost({ ...zero, SELF_HOSTED: 100 });
    expect(cost).toBe(0);
  });

  it("sums costs across all categories", () => {
    const cost = calculateRunCost({ UBUNTU: 10, MACOS: 5, WINDOWS: 8, SELF_HOSTED: 50 });
    const expected =
      10 * GITHUB_RATES.UBUNTU +
      5 * GITHUB_RATES.MACOS +
      8 * GITHUB_RATES.WINDOWS;
    expect(cost).toBeCloseTo(expected);
  });

  it("handles fractional minutes correctly", () => {
    const cost = calculateRunCost({ ...zero, UBUNTU: 1.5 });
    expect(cost).toBeCloseTo(1.5 * GITHUB_RATES.UBUNTU);
  });

  it("handles sub-minute fractions", () => {
    const cost = calculateRunCost({ ...zero, UBUNTU: 0.333 });
    expect(cost).toBeCloseTo(0.333 * GITHUB_RATES.UBUNTU);
  });
});

describe("aggregatePrCost", () => {
  const makeTiming = (
    runId: number,
    workflow: string,
    billable: BillableMinutes,
  ): RunTiming => ({
    runId,
    workflow,
    billable,
    cost: calculateRunCost(billable),
  });

  const bill = (u: number, m: number, w: number, sh: number = 0): BillableMinutes =>
    ({ UBUNTU: u, MACOS: m, WINDOWS: w, SELF_HOSTED: sh });

  it("aggregates a single run", () => {
    const timings = [makeTiming(1, "CI", bill(5, 0, 0))];
    const summary = aggregatePrCost(timings, 42, "org/repo");

    expect(summary.pr).toBe(42);
    expect(summary.repo).toBe("org/repo");
    expect(summary.runCount).toBe(1);
    expect(summary.totalCost).toBeCloseTo(5 * GITHUB_RATES.UBUNTU);
    expect(summary.totalBillableMinutes.UBUNTU).toBe(5);
    expect(summary.totalBillableMinutes.SELF_HOSTED).toBe(0);
    expect(summary.workflows).toHaveLength(1);
    expect(summary.workflows[0].name).toBe("CI");
    expect(summary.workflows[0].runs).toBe(1);
  });

  it("aggregates multiple runs of the same workflow", () => {
    const timings = [
      makeTiming(1, "CI", bill(5, 0, 0)),
      makeTiming(2, "CI", bill(3, 0, 0)),
    ];
    const summary = aggregatePrCost(timings, 42, "org/repo");

    expect(summary.runCount).toBe(2);
    expect(summary.totalBillableMinutes.UBUNTU).toBe(8);
    expect(summary.workflows).toHaveLength(1);
    expect(summary.workflows[0].runs).toBe(2);
  });

  it("aggregates multiple workflows sorted by cost descending", () => {
    const timings = [
      makeTiming(1, "CI", bill(2, 0, 0)),
      makeTiming(2, "Deploy", bill(0, 10, 0)),
    ];
    const summary = aggregatePrCost(timings, 7, "org/repo");

    expect(summary.workflows).toHaveLength(2);
    expect(summary.workflows[0].name).toBe("Deploy");
    expect(summary.workflows[1].name).toBe("CI");
  });

  it("handles empty timings", () => {
    const summary = aggregatePrCost([], 1, "org/repo");

    expect(summary.runCount).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.workflows).toHaveLength(0);
    for (const cat of RUNNER_CATEGORIES) {
      expect(summary.totalBillableMinutes[cat]).toBe(0);
    }
  });

  it("handles fractional billable minutes", () => {
    const timings = [
      makeTiming(1, "CI", bill(3.5, 0.75, 0)),
    ];
    const summary = aggregatePrCost(timings, 10, "org/repo");

    expect(summary.totalBillableMinutes.UBUNTU).toBeCloseTo(3.5);
    expect(summary.totalBillableMinutes.MACOS).toBeCloseTo(0.75);
    const expected = 3.5 * GITHUB_RATES.UBUNTU + 0.75 * GITHUB_RATES.MACOS;
    expect(summary.totalCost).toBeCloseTo(expected);
  });

  it("tracks self-hosted minutes separately with zero cost", () => {
    const timings = [
      makeTiming(1, "CI", bill(5, 0, 0, 20)),
    ];
    const summary = aggregatePrCost(timings, 1, "org/repo");

    expect(summary.totalBillableMinutes.SELF_HOSTED).toBe(20);
    expect(summary.totalBillableMinutes.UBUNTU).toBe(5);
    expect(summary.totalCost).toBeCloseTo(5 * GITHUB_RATES.UBUNTU);
  });

  it("uses pre-computed cost from RunTiming", () => {
    const timing: RunTiming = {
      runId: 1,
      workflow: "CI",
      billable: bill(10, 0, 0, 5),
      cost: 0.50,
    };
    const summary = aggregatePrCost([timing], 1, "org/repo");
    expect(summary.totalCost).toBeCloseTo(0.50);
  });
});
