import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { detectRepo, checkGhCli, fetchAllRuns } from "./github.js";
import { aggregate } from "./aggregate.js";
import { renderTable, renderCsv, renderJson } from "./output.js";
import type { CliOptions } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

const program = new Command()
  .name("actions-usage")
  .description("Show GitHub Actions usage metrics per developer")
  .version(pkg.version)
  .option("--repo <owner/repo>", "target repository (default: detect from git remote)")
  .option("--since <date>", "start date YYYY-MM-DD (default: start of current month)")
  .option("--until <date>", "end date YYYY-MM-DD (default: today)")
  .option("--format <type>", "output format: table, csv, json", "table")
  .option("--sort <field>", "sort by: minutes, runs, name", "minutes")
  .option("--csv <path>", "export CSV to file")
  .action((opts) => {
    const options: CliOptions = {
      repo: opts.repo ?? "",
      since: opts.since ?? startOfMonthStr(),
      until: opts.until ?? todayStr(),
      format: opts.format ?? "table",
      sort: opts.sort ?? "minutes",
      csv: opts.csv,
    };

    // Validate
    checkGhCli();

    if (!options.repo) {
      process.stderr.write("Detecting repo from git remote...\n");
      options.repo = detectRepo();
    }

    process.stderr.write(
      `Fetching GitHub Actions runs for ${options.repo} (${options.since} to ${options.until})...\n`,
    );

    const runs = fetchAllRuns(options.repo, options.since, options.until);

    if (runs.length === 0) {
      process.stderr.write("No completed runs found in this period.\n");
      process.exit(0);
    }

    process.stderr.write(`Total: ${runs.length} completed runs\n\n`);

    const data = aggregate(
      runs,
      options.repo,
      options.since,
      options.until,
      options.sort,
    );

    // CSV file export (can be combined with any format)
    if (options.csv) {
      renderCsv(data, options.csv);
    }

    switch (options.format) {
      case "csv":
        renderCsv(data);
        break;
      case "json":
        renderJson(data);
        break;
      default:
        renderTable(data);
    }
  });

program.parse();
