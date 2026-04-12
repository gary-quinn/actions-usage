import chalk from "chalk";
import Table from "cli-table3";
import { writeFileSync } from "node:fs";
import type { AggregatedData } from "./types.js";
import type { FetchResult } from "./github.js";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function formatMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year.slice(2)}`;
}

export function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function shortRepoName(
  repos: readonly string[],
): (repo: string) => string {
  const owners = new Set(repos.map((r) => r.split("/")[0]));
  return owners.size === 1 ? (repo) => repo.split("/")[1] : (repo) => repo;
}

export function formatRepoDisplay(repos: readonly string[]): string {
  if (repos.length <= 3) return repos.join(", ");
  return `${repos.length} repositories`;
}

export function formatFetchSummary(
  results: readonly FetchResult[],
): string {
  const active = results.filter((r) => r.runs.length > 0);
  const skippedCount = results.length - active.length;
  const failedCount = results.filter((r) => r.warnings.length > 0).length;

  if (active.length === 0 && failedCount === 0) return "";

  const warningSet = new Set(
    results.filter((r) => r.warnings.length > 0).map((r) => r.repo),
  );
  const maxLen = active.length > 0
    ? Math.max(...active.map((r) => r.repo.length))
    : 0;
  const lines = active.map((r) => {
    const partial = warningSet.has(r.repo) ? " (partial)" : "";
    return `  ${r.repo.padEnd(maxLen)}  ${String(r.runs.length).padStart(5)} runs${partial}`;
  });

  if (skippedCount > 0) {
    const noun = skippedCount === 1 ? "repo" : "repos";
    lines.push(`  (${skippedCount} ${noun} with no runs)`);
  }

  if (failedCount > 0) {
    const noun = failedCount === 1 ? "repo" : "repos";
    lines.push(`  (${failedCount} ${noun} had fetch errors)`);
  }

  return lines.join("\n");
}

const rightAligned = (content: string) =>
  ({ content, hAlign: "right" as const });

export function renderTable(data: AggregatedData): void {
  const { months, users, totals, workflows, repos } = data;
  const multiRepo = repos.length > 1;
  const getRepoLabel = multiRepo ? shortRepoName(repos) : undefined;

  console.log();
  console.log(chalk.bold("GitHub Actions Usage Per Developer"));
  console.log(chalk.dim(`${formatRepoDisplay(repos)} | ${data.since} to ${data.until}`));
  console.log();

  const head = [
    chalk.bold("Developer"),
    ...(multiRepo ? [chalk.bold("Repo")] : []),
    chalk.bold("Total min"),
    chalk.bold("Hours"),
    chalk.bold("Runs"),
    ...months.map((m) => chalk.bold(formatMonthLabel(m))),
  ];

  const table = new Table({
    head,
    style: { head: [], border: [] },
    chars: {
      mid: "─",
      "left-mid": "├",
      "mid-mid": "┼",
      "right-mid": "┤",
    },
  });

  for (const user of users) {
    table.push([
      user.actor,
      ...(getRepoLabel ? [getRepoLabel(user.repo)] : []),
      rightAligned(Math.round(user.totalMinutes).toLocaleString()),
      rightAligned((user.totalMinutes / 60).toFixed(1)),
      rightAligned(user.totalRuns.toLocaleString()),
      ...months.map((m) =>
        rightAligned(Math.round(user.monthlyMinutes[m] ?? 0).toLocaleString()),
      ),
    ]);
  }

  table.push([
    chalk.bold("TOTAL"),
    ...(multiRepo ? [""] : []),
    rightAligned(chalk.bold(Math.round(totals.minutes).toLocaleString())),
    rightAligned(chalk.bold((totals.minutes / 60).toFixed(1))),
    rightAligned(chalk.bold(totals.runs.toLocaleString())),
    ...months.map((m) =>
      rightAligned(chalk.bold(Math.round(totals.monthly[m] ?? 0).toLocaleString())),
    ),
  ]);

  console.log(table.toString());

  console.log();
  console.log(chalk.bold("Top workflows:"));
  for (const wf of workflows.slice(0, 8)) {
    const pct =
      totals.minutes > 0
        ? ((wf.minutes / totals.minutes) * 100).toFixed(1)
        : "0.0";
    console.log(
      `  ${wf.name.padEnd(40)} ${Math.round(wf.minutes).toLocaleString().padStart(7)} min (${pct.padStart(5)}%)  [${wf.runs} runs]`,
    );
  }

  console.log();
  console.log(
    chalk.dim(
      "Note: Minutes are wall-clock duration, not GitHub billable minutes.",
    ),
  );
}

function buildCsvRow(
  fields: readonly (string | number)[],
): string {
  return fields.map(escapeCsvField).join(",");
}

export function renderCsv(data: AggregatedData, filePath?: string): void {
  const { months, users, totals, repos } = data;
  const multiRepo = repos.length > 1;

  const headers: readonly string[] = [
    "developer",
    ...(multiRepo ? ["repo"] : []),
    "total_minutes",
    "hours",
    "runs",
    ...months.map((m) => m.toLowerCase()),
  ];

  const lines = [
    buildCsvRow(headers),
    ...users.map((user) =>
      buildCsvRow([
        user.actor,
        ...(multiRepo ? [user.repo] : []),
        Math.round(user.totalMinutes),
        (user.totalMinutes / 60).toFixed(1),
        user.totalRuns,
        ...months.map((m) => Math.round(user.monthlyMinutes[m] ?? 0)),
      ]),
    ),
    buildCsvRow([
      "TOTAL",
      ...(multiRepo ? [""] : []),
      Math.round(totals.minutes),
      (totals.minutes / 60).toFixed(1),
      totals.runs,
      ...months.map((m) => Math.round(totals.monthly[m] ?? 0)),
    ]),
  ];

  const csv = lines.join("\n") + "\n";

  if (filePath) {
    writeFileSync(filePath, csv, "utf-8");
    process.stderr.write(`CSV written to ${filePath}\n`);
  } else {
    process.stdout.write(csv);
  }
}

export function renderJson(data: AggregatedData): void {
  const output = {
    repos: data.repos,
    period: { since: data.since, until: data.until },
    users: data.users.map((u) => ({
      developer: u.actor,
      repo: u.repo,
      totalMinutes: Math.round(u.totalMinutes),
      hours: Number((u.totalMinutes / 60).toFixed(1)),
      runs: u.totalRuns,
      monthly: Object.fromEntries(
        data.months.map((m) => [m, Math.round(u.monthlyMinutes[m] ?? 0)]),
      ),
    })),
    totals: {
      minutes: Math.round(data.totals.minutes),
      hours: Number((data.totals.minutes / 60).toFixed(1)),
      runs: data.totals.runs,
    },
    workflows: data.workflows.slice(0, 10).map((w) => ({
      name: w.name,
      minutes: Math.round(w.minutes),
      runs: w.runs,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}
