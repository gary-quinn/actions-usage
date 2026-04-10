import chalk from "chalk";
import Table from "cli-table3";
import { writeFileSync } from "node:fs";
import type { AggregatedData } from "./types.js";

export function renderTable(data: AggregatedData): void {
  const { months, users, totals, workflows } = data;

  // Header
  console.log();
  console.log(
    chalk.bold(`GitHub Actions Usage Per Developer`),
  );
  console.log(
    chalk.dim(`${data.repo} | ${data.since} to ${data.until}`),
  );
  console.log();

  // Main table
  const head = [
    chalk.bold("Developer"),
    chalk.bold("Total min"),
    chalk.bold("Hours"),
    chalk.bold("Runs"),
    ...months.map((m) => chalk.bold(m)),
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
    const pct = totals.minutes > 0
      ? ((user.totalMinutes / totals.minutes) * 100).toFixed(1)
      : "0.0";

    table.push([
      user.actor,
      { content: Math.round(user.totalMinutes).toLocaleString(), hAlign: "right" },
      { content: (user.totalMinutes / 60).toFixed(1), hAlign: "right" },
      { content: user.totalRuns.toLocaleString(), hAlign: "right" },
      ...months.map((m) => ({
        content: Math.round(user.monthlyMinutes[m] ?? 0).toLocaleString(),
        hAlign: "right" as const,
      })),
    ]);
  }

  // Totals row
  table.push([
    chalk.bold("TOTAL"),
    { content: chalk.bold(Math.round(totals.minutes).toLocaleString()), hAlign: "right" },
    { content: chalk.bold((totals.minutes / 60).toFixed(1)), hAlign: "right" },
    { content: chalk.bold(totals.runs.toLocaleString()), hAlign: "right" },
    ...months.map((m) => ({
      content: chalk.bold(Math.round(totals.monthly[m] ?? 0).toLocaleString()),
      hAlign: "right" as const,
    })),
  ]);

  console.log(table.toString());

  // Workflow summary
  console.log();
  console.log(chalk.bold("Top workflows:"));
  const topWf = workflows.slice(0, 8);
  for (const wf of topWf) {
    const pct = totals.minutes > 0
      ? ((wf.minutes / totals.minutes) * 100).toFixed(1)
      : "0.0";
    console.log(
      `  ${wf.name.padEnd(40)} ${Math.round(wf.minutes).toLocaleString().padStart(7)} min (${pct.padStart(5)}%)  [${wf.runs} runs]`,
    );
  }

  console.log();
  console.log(chalk.dim("Note: Minutes are wall-clock duration, not GitHub billable minutes."));
}

export function renderCsv(data: AggregatedData, filePath?: string): void {
  const { months, users, totals } = data;

  const headers = ["developer", "total_minutes", "hours", "runs", ...months.map((m) => m.toLowerCase())];
  const lines: string[] = [headers.join(",")];

  for (const user of users) {
    const row = [
      user.actor,
      Math.round(user.totalMinutes),
      (user.totalMinutes / 60).toFixed(1),
      user.totalRuns,
      ...months.map((m) => Math.round(user.monthlyMinutes[m] ?? 0)),
    ];
    lines.push(row.join(","));
  }

  // Totals
  lines.push(
    [
      "TOTAL",
      Math.round(totals.minutes),
      (totals.minutes / 60).toFixed(1),
      totals.runs,
      ...months.map((m) => Math.round(totals.monthly[m] ?? 0)),
    ].join(","),
  );

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
    repo: data.repo,
    period: { since: data.since, until: data.until },
    users: data.users.map((u) => ({
      developer: u.actor,
      totalMinutes: Math.round(u.totalMinutes),
      hours: Number((u.totalMinutes / 60).toFixed(1)),
      runs: u.totalRuns,
      monthly: Object.fromEntries(
        data.months.map((m) => [m.toLowerCase(), Math.round(u.monthlyMinutes[m] ?? 0)]),
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
