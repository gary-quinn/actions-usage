import { Command, Option } from "commander";
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

const todayStr = (): string => new Date().toISOString().slice(0, 10);

const startOfMonthStr = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

const program = new Command()
  .name("actions-usage")
  .description("Show GitHub Actions usage metrics per developer")
  .version(pkg.version)
  .option(
    "--repo <owner/repo>",
    "target repository (default: detect from git remote)",
  )
  .option(
    "--since <date>",
    "start date YYYY-MM-DD (default: start of current month)",
  )
  .option("--until <date>", "end date YYYY-MM-DD (default: today)")
  .addOption(
    new Option("--format <type>", "output format")
      .choices(["table", "csv", "json"])
      .default("table"),
  )
  .addOption(
    new Option("--sort <field>", "sort by")
      .choices(["minutes", "runs", "name"])
      .default("minutes"),
  )
  .option("--csv <path>", "export CSV to file")
  .action(async (opts) => {
    try {
      const options: CliOptions = {
        repo: opts.repo ?? "",
        since: opts.since ?? startOfMonthStr(),
        until: opts.until ?? todayStr(),
        format: opts.format ?? "table",
        sort: opts.sort ?? "minutes",
        csv: opts.csv,
      };

      await checkGhCli();

      if (!options.repo) {
        process.stderr.write("Detecting repo from git remote...\n");
        options.repo = await detectRepo();
      }

      process.stderr.write(
        `Fetching GitHub Actions runs for ${options.repo} (${options.since} to ${options.until})...\n`,
      );

      const runs = await fetchAllRuns(
        options.repo,
        options.since,
        options.until,
      );

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
    } catch (err) {
      process.stderr.write(
        `Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  });

await program.parseAsync();
