export const RUNNER_OS_KEYS = ["UBUNTU", "MACOS", "WINDOWS"] as const;
export type RunnerOs = (typeof RUNNER_OS_KEYS)[number];

/**
 * GitHub Actions per-minute rates (USD) for private repos on standard runners.
 * Source: https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
 * As of 2025-04. Larger runners (4x/8x/GPU) have different rates not covered here.
 */
export const GITHUB_RATES: Readonly<Record<RunnerOs, number>> = {
  UBUNTU: 0.008,
  MACOS: 0.08,
  WINDOWS: 0.016,
} as const;

export interface RunTiming {
  readonly runId: number;
  readonly workflow: string;
  readonly billable: Readonly<Record<RunnerOs, number>>; // minutes
}

export interface WorkflowCost {
  readonly name: string;
  readonly runs: number;
  readonly billable: Readonly<Record<RunnerOs, number>>;
  readonly cost: number;
}

export interface PrCostSummary {
  readonly pr: number;
  readonly repo: string;
  readonly totalCost: number;
  readonly totalBillableMinutes: Readonly<Record<RunnerOs, number>>;
  readonly workflows: readonly WorkflowCost[];
  readonly runCount: number;
}

export function formatDollar(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function calculateRunCost(billable: Readonly<Record<RunnerOs, number>>): number {
  let cost = 0;
  for (const os of RUNNER_OS_KEYS) {
    cost += billable[os] * GITHUB_RATES[os];
  }
  return cost;
}

export function aggregatePrCost(
  timings: readonly RunTiming[],
  pr: number,
  repo: string,
): PrCostSummary {
  const workflowMap = new Map<
    string,
    { runs: number; billable: Record<RunnerOs, number>; cost: number }
  >();

  const totalBillable: Record<RunnerOs, number> = { UBUNTU: 0, MACOS: 0, WINDOWS: 0 };
  let totalCost = 0;

  for (const timing of timings) {
    const runCost = calculateRunCost(timing.billable);
    totalCost += runCost;

    for (const os of RUNNER_OS_KEYS) {
      totalBillable[os] += timing.billable[os];
    }

    const existing = workflowMap.get(timing.workflow);
    if (existing) {
      existing.runs += 1;
      existing.cost += runCost;
      for (const os of RUNNER_OS_KEYS) {
        existing.billable[os] += timing.billable[os];
      }
    } else {
      workflowMap.set(timing.workflow, {
        runs: 1,
        billable: { ...timing.billable },
        cost: runCost,
      });
    }
  }

  const workflows: readonly WorkflowCost[] = [...workflowMap.entries()]
    .map(([name, data]) => ({
      name,
      runs: data.runs,
      billable: { UBUNTU: data.billable.UBUNTU, MACOS: data.billable.MACOS, WINDOWS: data.billable.WINDOWS },
      cost: data.cost,
    }))
    .sort((a, b) => b.cost - a.cost);

  return {
    pr,
    repo,
    totalCost,
    totalBillableMinutes: totalBillable,
    workflows,
    runCount: timings.length,
  };
}
