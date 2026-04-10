export interface WorkflowRun {
  id: number;
  actor: string;
  workflow: string;
  startedAt: string;
  updatedAt: string;
}

export interface UserStats {
  actor: string;
  totalMinutes: number;
  totalRuns: number;
  monthlyMinutes: Record<string, number>;
  workflows: Record<string, { minutes: number; runs: number }>;
}

export interface AggregatedData {
  repo: string;
  since: string;
  until: string;
  months: string[];
  users: UserStats[];
  totals: {
    minutes: number;
    runs: number;
    monthly: Record<string, number>;
  };
  workflows: { name: string; minutes: number; runs: number }[];
}

export interface CliOptions {
  repo: string;
  since: string;
  until: string;
  format: "table" | "csv" | "json";
  sort: "minutes" | "runs" | "name";
  csv?: string;
}
