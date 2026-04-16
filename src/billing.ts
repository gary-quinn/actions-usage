export const RUNNER_CATEGORIES = ["UBUNTU", "MACOS", "WINDOWS", "SELF_HOSTED"] as const;
export type RunnerCategory = (typeof RUNNER_CATEGORIES)[number];

export const GITHUB_HOSTED_CATEGORIES = ["UBUNTU", "MACOS", "WINDOWS"] as const;

export type BillableMinutes = Record<RunnerCategory, number>;

export function zeroBillable(): BillableMinutes {
  return { UBUNTU: 0, MACOS: 0, WINDOWS: 0, SELF_HOSTED: 0 };
}

/**
 * GitHub Actions per-minute rates (USD) for private repos on standard runners.
 * https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
 */
export const GITHUB_RATES: Readonly<Record<RunnerCategory, number>> = {
  UBUNTU: 0.008,
  MACOS: 0.08,
  WINDOWS: 0.016,
  SELF_HOSTED: 0,
} as const;

// macOS larger runner rates (non-linear, can't derive from core count)
const MACOS_LARGE_RATE = 0.12;
const MACOS_XLARGE_RATE = 0.16;

export interface RunTiming {
  readonly runId: number;
  readonly workflow: string;
  readonly billable: Readonly<BillableMinutes>;
  readonly cost: number;
}

export interface WorkflowCost {
  readonly name: string;
  readonly runs: number;
  readonly billable: Readonly<BillableMinutes>;
  readonly cost: number;
}

export interface PrCostSummary {
  readonly pr: number;
  readonly repo: string;
  readonly totalCost: number;
  readonly totalBillableMinutes: Readonly<BillableMinutes>;
  readonly workflows: readonly WorkflowCost[];
  readonly runCount: number;
  readonly estimated: boolean;
}

export function formatDollar(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Classify runner from job labels. Self-hosted is detected first;
 * then OS is matched from GitHub-hosted and bare OS labels.
 */
export function classifyRunner(labels: readonly string[]): RunnerCategory {
  for (const label of labels) {
    if (label.toLowerCase() === "self-hosted") return "SELF_HOSTED";
  }
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "windows" || lower.startsWith("windows-")) return "WINDOWS";
    if (lower === "macos" || lower.startsWith("macos-") ||
        lower === "mac" || lower.startsWith("mac-")) return "MACOS";
    if (lower === "linux" || lower.startsWith("linux-") ||
        lower === "ubuntu" || lower.startsWith("ubuntu-")) return "UBUNTU";
  }
  return "UBUNTU";
}

function parseCoreCount(labels: readonly string[]): number | null {
  for (const label of labels) {
    const match = label.match(/(\d+)-cores?$/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function isMacosLargerRunner(labels: readonly string[]): "large" | "xlarge" | null {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (/macos.*xlarge/.test(lower)) return "xlarge";
    if (/macos.*large/.test(lower)) return "large";
  }
  return null;
}

/**
 * Resolve per-minute rate for a job based on runner labels.
 * Handles self-hosted (configurable), GitHub larger runners
 * (core-count multiplier), and standard runners (flat rate).
 */
export function rateForLabels(
  labels: readonly string[],
  selfHostedRate: number = 0,
): number {
  const category = classifyRunner(labels);
  if (category === "SELF_HOSTED") return selfHostedRate;

  if (category === "MACOS") {
    const size = isMacosLargerRunner(labels);
    if (size === "xlarge") return MACOS_XLARGE_RATE;
    if (size === "large") return MACOS_LARGE_RATE;
  }

  // Linux/Windows larger runners: rate scales linearly with core count
  // Standard is 2-core; 4-core = 2x rate, 8-core = 4x rate, etc.
  const cores = parseCoreCount(labels);
  if (cores !== null) {
    return GITHUB_RATES[category] * (cores / 2);
  }

  return GITHUB_RATES[category];
}

export function calculateRunCost(billable: Readonly<BillableMinutes>): number {
  let cost = 0;
  for (const category of RUNNER_CATEGORIES) {
    cost += billable[category] * GITHUB_RATES[category];
  }
  return cost;
}

export function aggregatePrCost(
  timings: readonly RunTiming[],
  pr: number,
  repo: string,
  estimated: boolean = false,
): PrCostSummary {
  const workflowMap = new Map<
    string,
    { runs: number; billable: BillableMinutes; cost: number }
  >();

  const totalBillable = zeroBillable();
  let totalCost = 0;

  for (const timing of timings) {
    totalCost += timing.cost;

    for (const cat of RUNNER_CATEGORIES) {
      totalBillable[cat] += timing.billable[cat];
    }

    const existing = workflowMap.get(timing.workflow);
    if (existing) {
      existing.runs += 1;
      existing.cost += timing.cost;
      for (const cat of RUNNER_CATEGORIES) {
        existing.billable[cat] += timing.billable[cat];
      }
    } else {
      workflowMap.set(timing.workflow, {
        runs: 1,
        billable: { ...timing.billable },
        cost: timing.cost,
      });
    }
  }

  const workflows: readonly WorkflowCost[] = [...workflowMap.entries()]
    .map(([name, data]) => ({
      name,
      runs: data.runs,
      billable: { ...data.billable },
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
    estimated,
  };
}
