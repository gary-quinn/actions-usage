import chalk from "chalk";
import Table from "cli-table3";
import type { AggregatedData } from "./types.js";
import { TOP_WORKFLOWS } from "./types.js";
import type { FetchResult } from "./github.js";
import type { PrCostSummary } from "./billing.js";
import { formatDollar } from "./billing.js";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function formatMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
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

function shouldShowRepo(data: AggregatedData): boolean {
  return data.repos.length > 1 && !data.groupBy;
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

export function renderTable(data: AggregatedData): string {
  const { months, users, totals, workflows, repos } = data;
  const showRepo = shouldShowRepo(data);
  const getRepoLabel = showRepo ? shortRepoName(repos) : undefined;

  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("GitHub Actions Usage Per Developer"));
  lines.push(chalk.dim(`${formatRepoDisplay(repos)} | ${data.since} to ${data.until}`));
  lines.push("");

  const head = [
    chalk.bold("Developer"),
    ...(showRepo ? [chalk.bold("Repo")] : []),
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
    ...(showRepo ? [""] : []),
    rightAligned(chalk.bold(Math.round(totals.minutes).toLocaleString())),
    rightAligned(chalk.bold((totals.minutes / 60).toFixed(1))),
    rightAligned(chalk.bold(totals.runs.toLocaleString())),
    ...months.map((m) =>
      rightAligned(chalk.bold(Math.round(totals.monthly[m] ?? 0).toLocaleString())),
    ),
  ]);

  lines.push(table.toString());

  lines.push("");
  lines.push(chalk.bold("Top workflows:"));
  for (const wf of workflows.slice(0, TOP_WORKFLOWS)) {
    const pct =
      totals.minutes > 0
        ? ((wf.minutes / totals.minutes) * 100).toFixed(1)
        : "0.0";
    lines.push(
      `  ${wf.name.padEnd(40)} ${Math.round(wf.minutes).toLocaleString().padStart(7)} min (${pct.padStart(5)}%)  [${wf.runs} runs]`,
    );
  }

  lines.push("");
  lines.push(
    chalk.dim(
      "Note: Minutes are wall-clock duration, not GitHub billable minutes.",
    ),
  );

  return lines.join("\n") + "\n";
}

function buildCsvRow(
  fields: readonly (string | number)[],
): string {
  return fields.map(escapeCsvField).join(",");
}

export function renderCsv(data: AggregatedData): string {
  const { months, users, totals } = data;
  const showRepo = shouldShowRepo(data);

  const headers: readonly string[] = [
    "developer",
    ...(showRepo ? ["repo"] : []),
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
        ...(showRepo ? [user.repo] : []),
        Math.round(user.totalMinutes),
        (user.totalMinutes / 60).toFixed(1),
        user.totalRuns,
        ...months.map((m) => Math.round(user.monthlyMinutes[m] ?? 0)),
      ]),
    ),
    buildCsvRow([
      "TOTAL",
      ...(showRepo ? [""] : []),
      Math.round(totals.minutes),
      (totals.minutes / 60).toFixed(1),
      totals.runs,
      ...months.map((m) => Math.round(totals.monthly[m] ?? 0)),
    ]),
  ];

  return lines.join("\n") + "\n";
}

export function renderMarkdown(data: AggregatedData): string {
  const { months, users, totals, workflows, repos } = data;
  const showRepo = shouldShowRepo(data);
  const getRepoLabel = showRepo ? shortRepoName(repos) : undefined;

  const lines: string[] = [];

  lines.push("## GitHub Actions Usage Report");
  lines.push("");
  // Intentionally checks repo count, not shouldShowRepo() — the header
  // should say "N repositories" even when grouped (repo column is hidden).
  lines.push(
    repos.length > 1
      ? `**${repos.length} repositories** | ${data.since} to ${data.until}`
      : `**${repos[0]}** | ${data.since} to ${data.until}`,
  );
  lines.push("");

  // Table header
  const headers = [
    "Developer",
    ...(showRepo ? ["Repo"] : []),
    "Minutes",
    "Hours",
    "Runs",
    ...months.map(formatMonthLabel),
  ];
  lines.push(`| ${headers.join(" | ")} |`);
  const align = headers.map((_, i) =>
    i === 0 || (showRepo && i === 1) ? "---" : "---:",
  );
  lines.push(`| ${align.join(" | ")} |`);

  // User rows
  for (const user of users) {
    const cells = [
      user.actor,
      ...(getRepoLabel ? [getRepoLabel(user.repo)] : []),
      String(Math.round(user.totalMinutes)),
      (user.totalMinutes / 60).toFixed(1),
      String(user.totalRuns),
      ...months.map((m) => String(Math.round(user.monthlyMinutes[m] ?? 0))),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  // Totals row
  const totalCells = [
    "**TOTAL**",
    ...(showRepo ? [""] : []),
    `**${Math.round(totals.minutes)}**`,
    `**${(totals.minutes / 60).toFixed(1)}**`,
    `**${totals.runs}**`,
    ...months.map((m) => `**${Math.round(totals.monthly[m] ?? 0)}**`),
  ];
  lines.push(`| ${totalCells.join(" | ")} |`);

  // Top workflows
  if (workflows.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Top workflows</summary>");
    lines.push("");
    lines.push("| Workflow | Minutes | Runs |");
    lines.push("|----------|--------:|-----:|");
    for (const wf of workflows.slice(0, TOP_WORKFLOWS)) {
      lines.push(`| ${wf.name} | ${Math.round(wf.minutes)} | ${wf.runs} |`);
    }
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n") + "\n";
}

function formatMinutes(minutes: number): string {
  return minutes > 0 ? `${Math.round(minutes)}m` : "0m";
}

export function renderPrCostMarkdown(summary: PrCostSummary): string {
  const lines: string[] = [];

  const costLabel = summary.estimated ? "Estimated CI Cost" : "CI Cost";
  lines.push(`## ${costLabel}: ${formatDollar(summary.totalCost)}`);
  lines.push("");
  lines.push(`**${summary.repo}** \u2014 PR #${summary.pr} \u00b7 ${summary.runCount} workflow run${summary.runCount !== 1 ? "s" : ""}`);
  lines.push("");

  lines.push("| Workflow | Runs | Linux | macOS | Windows | Cost |");
  lines.push("|----------|-----:|------:|------:|--------:|-----:|");

  for (const wf of summary.workflows) {
    lines.push(
      `| ${wf.name} | ${wf.runs} | ${formatMinutes(wf.billable.UBUNTU)} | ${formatMinutes(wf.billable.MACOS)} | ${formatMinutes(wf.billable.WINDOWS)} | ${formatDollar(wf.cost)} |`,
    );
  }

  const tb = summary.totalBillableMinutes;
  lines.push(
    `| **Total** | **${summary.runCount}** | **${formatMinutes(tb.UBUNTU)}** | **${formatMinutes(tb.MACOS)}** | **${formatMinutes(tb.WINDOWS)}** | **${formatDollar(summary.totalCost)}** |`,
  );

  lines.push("");
  if (summary.estimated) {
    lines.push(
      "> Estimated cost based on job durations — actual billing may differ due to included plan minutes. Rates from GitHub Actions [published rates](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions).",
    );
  } else {
    lines.push(
      "> Based on GitHub Actions [published rates](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions). Public repos are free; rates shown are for private repos.",
    );
  }

  return lines.join("\n") + "\n";
}

export function renderPrCostJson(summary: PrCostSummary): string {
  const output = {
    pr: summary.pr,
    repo: summary.repo,
    totalCost: Number(summary.totalCost.toFixed(2)),
    totalCostFormatted: formatDollar(summary.totalCost),
    runCount: summary.runCount,
    estimated: summary.estimated,
    billableMinutes: {
      linux: Math.round(summary.totalBillableMinutes.UBUNTU),
      macos: Math.round(summary.totalBillableMinutes.MACOS),
      windows: Math.round(summary.totalBillableMinutes.WINDOWS),
    },
    workflows: summary.workflows.map((wf) => ({
      name: wf.name,
      runs: wf.runs,
      cost: Number(wf.cost.toFixed(2)),
      billableMinutes: {
        linux: Math.round(wf.billable.UBUNTU),
        macos: Math.round(wf.billable.MACOS),
        windows: Math.round(wf.billable.WINDOWS),
      },
    })),
  };

  return JSON.stringify(output, null, 2) + "\n";
}

export function renderJson(data: AggregatedData): string {
  const output = {
    repos: data.repos,
    ...(data.groupBy ? { groupedBy: data.groupBy } : {}),
    period: { since: data.since, until: data.until },
    users: data.users.map((u) => ({
      developer: u.actor,
      ...(data.groupBy ? {} : { repo: u.repo }),
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
    workflows: data.workflows.slice(0, TOP_WORKFLOWS).map((w) => ({
      name: w.name,
      minutes: Math.round(w.minutes),
      runs: w.runs,
    })),
  };

  return JSON.stringify(output, null, 2) + "\n";
}
