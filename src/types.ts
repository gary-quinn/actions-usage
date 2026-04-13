export interface WorkflowRun {
  readonly id: number;
  readonly repo: string;
  readonly actor: string;
  readonly workflow: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface UserStats {
  readonly actor: string;
  readonly repo: string;
  readonly totalMinutes: number;
  readonly totalRuns: number;
  readonly monthlyMinutes: Record<string, number>;
  readonly workflows: Record<string, { minutes: number; runs: number }>;
}

export interface AggregatedData {
  readonly repos: readonly string[];
  readonly since: string;
  readonly until: string;
  readonly months: readonly string[];
  readonly users: readonly UserStats[];
  readonly totals: {
    readonly minutes: number;
    readonly runs: number;
    readonly monthly: Record<string, number>;
  };
  readonly workflows: readonly {
    readonly name: string;
    readonly minutes: number;
    readonly runs: number;
  }[];
  readonly groupBy?: GroupBy;
}

export type SortField = "minutes" | "runs" | "name";
export type GroupBy = "actor";

export interface OrgFilterOptions {
  readonly includeForks?: boolean;
  readonly includeArchived?: boolean;
}

export interface CliOptions {
  repos: readonly string[];
  org?: string;
  since: string;
  until: string;
  format: "table" | "csv" | "json" | "markdown";
  sort: SortField;
  exclude?: readonly string[];
  groupBy?: GroupBy;
  csv?: string;
  markdownFile?: string;
  includeForks?: boolean;
  includeArchived?: boolean;
}
