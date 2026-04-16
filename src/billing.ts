export const RUNNER_CATEGORIES = ["UBUNTU", "MACOS", "WINDOWS", "SELF_HOSTED"] as const;
export type RunnerCategory = (typeof RUNNER_CATEGORIES)[number];

export const GITHUB_HOSTED_CATEGORIES = ["UBUNTU", "MACOS", "WINDOWS"] as const;

export type BillableMinutes = Record<RunnerCategory, number>;

export function zeroBillable(): BillableMinutes {
  return { UBUNTU: 0, MACOS: 0, WINDOWS: 0, SELF_HOSTED: 0 };
}

export interface CostOptions {
  readonly selfHostedRate?: number;
}

/**
 * GitHub Actions per-minute rates (USD) for private repos.
 * https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions
 */
export const GITHUB_RATES: Readonly<Record<RunnerCategory, number>> = {
  UBUNTU: 0.008,
  MACOS: 0.08,
  WINDOWS: 0.016,
  SELF_HOSTED: 0,
} as const;

export const LARGER_RUNNER_RATES = {
  MACOS_LARGE: 0.12,
  MACOS_XLARGE: 0.16,
} as const;

const VALID_LARGER_CORE_COUNTS = new Set([4, 8, 16, 32, 64]);

export interface ParsedRunner {
  readonly category: RunnerCategory;
  readonly coreCount: number | null;
  readonly macosSize: "large" | "xlarge" | null;
}

// Single pass over labels: extracts self-hosted flag, OS category,
// core count (Linux/Windows larger runners), and macOS size variant.
// Self-hosted scans all labels (position-independent) while OS uses
// first-match-wins so label order determines category on ambiguous sets.
export function parseRunnerLabels(labels: readonly string[]): ParsedRunner {
  let selfHosted = false;
  let category: RunnerCategory | null = null;
  let coreCount: number | null = null;
  let macosSize: "large" | "xlarge" | null = null;

  for (const label of labels) {
    const lower = label.toLowerCase();

    if (lower === "self-hosted") {
      selfHosted = true;
      continue;
    }

    const isWindows = lower === "windows" || lower.startsWith("windows-");
    const isMacos = lower === "macos" || lower.startsWith("macos-") ||
                    lower === "mac" || lower.startsWith("mac-");
    const isLinux = lower === "linux" || lower.startsWith("linux-") ||
                    lower === "ubuntu" || lower.startsWith("ubuntu-");

    if (category === null) {
      if (isWindows) category = "WINDOWS";
      else if (isMacos) category = "MACOS";
      else if (isLinux) category = "UBUNTU";
    }

    // Core count only from known OS labels (not arbitrary custom labels)
    if (coreCount === null && (isLinux || isWindows)) {
      const match = lower.match(/(\d+)-cores?$/);
      if (match) {
        const cores = parseInt(match[1], 10);
        if (VALID_LARGER_CORE_COUNTS.has(cores)) coreCount = cores;
      }
    }

    // endsWith for precision — no greedy .* regex
    if (macosSize === null && isMacos) {
      if (lower.endsWith("-xlarge")) macosSize = "xlarge";
      else if (lower.endsWith("-large")) macosSize = "large";
    }
  }

  return {
    category: selfHosted ? "SELF_HOSTED" : (category ?? "UBUNTU"),
    coreCount,
    macosSize,
  };
}

export function classifyRunner(labels: readonly string[]): RunnerCategory {
  return parseRunnerLabels(labels).category;
}

export function resolveRate(runner: ParsedRunner, options: CostOptions = {}): number {
  if (runner.category === "SELF_HOSTED") return options.selfHostedRate ?? 0;
  if (runner.macosSize === "xlarge") return LARGER_RUNNER_RATES.MACOS_XLARGE;
  if (runner.macosSize === "large") return LARGER_RUNNER_RATES.MACOS_LARGE;
  if (runner.coreCount !== null) return GITHUB_RATES[runner.category] * (runner.coreCount / 2);
  return GITHUB_RATES[runner.category];
}

export function rateForLabels(labels: readonly string[], selfHostedRate: number = 0): number {
  return resolveRate(parseRunnerLabels(labels), { selfHostedRate });
}

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
