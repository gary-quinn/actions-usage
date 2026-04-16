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

/** CLI exit codes */
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_NO_DATA = 2;

/** Max workflows shown in output (table, markdown, JSON). */
export const TOP_WORKFLOWS = 10;

export interface OrgFilterOptions {
  readonly includeForks?: boolean;
  readonly includeArchived?: boolean;
}

export interface CliOptions {
  readonly repos: readonly string[];
  readonly org?: string;
  readonly since: string;
  readonly until: string;
  readonly format: "table" | "csv" | "json" | "markdown";
  readonly sort: SortField;
  readonly exclude?: readonly string[];
  readonly groupBy?: GroupBy;
  readonly pr?: number;
  readonly csv?: string;
  readonly markdownFile?: string;
  readonly includeForks?: boolean;
  readonly includeArchived?: boolean;
}
