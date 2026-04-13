import { Command, Option } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkGhCli,
  fetchRepoRuns,
  fetchMultiRepoRuns,
  LARGE_ORG_THRESHOLD,
} from "./github.js";
import type { FetchResult } from "./github.js";
import { resolveRepos, formatResolveLog } from "./resolve.js";
import { aggregate, groupByActor } from "./aggregate.js";
import { renderTable, renderCsv, renderJson, renderMarkdown, formatRepoDisplay, formatFetchSummary } from "./output.js";
import type { CliOptions } from "./types.js";
import { EXIT_ERROR, EXIT_NO_DATA } from "./types.js";
import { todayStr, startOfMonthStr } from "./dates.js";
import { causeChain } from "./errors.js";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

async function fetchRuns(
  repos: readonly string[],
  since: string,
  until: string,
): Promise<readonly FetchResult[]> {
  process.stderr.write(
    `Fetching GitHub Actions runs for ${formatRepoDisplay(repos)} (${since} to ${until})...\n`,
  );

  if (repos.length > LARGE_ORG_THRESHOLD) {
    process.stderr.write(
      `  Warning: scanning ${repos.length} repos — this may take a while and could hit API rate limits\n`,
    );
  }

  const results =
    repos.length === 1
      ? [await fetchRepoRuns(repos[0], since, until)]
      : await fetchMultiRepoRuns(repos, since, until);

  const summary = formatFetchSummary(results);
  if (summary) process.stderr.write(summary + "\n");

  return results;
}

const program = new Command()
  .name("actions-usage")
  .description("Show GitHub Actions usage metrics per developer")
  .version(pkg.version)
  .option("--org <org-name>", "scan all repositories in a GitHub organization")
  .option(
    "--repo <repos...>",
    "target repositories (default: detect from git remote)",
  )
  .option(
    "--exclude <repos...>",
    "exclude specific repos when scanning an org",
  )
  .option(
    "--since <date>",
    "start date YYYY-MM-DD (default: start of current month)",
  )
  .option("--until <date>", "end date YYYY-MM-DD (default: today)")
  .addOption(
    new Option("--format <type>", "output format")
      .choices(["table", "csv", "json", "markdown"])
      .default("table"),
  )
  .addOption(
    new Option("--sort <field>", "sort by")
      .choices(["minutes", "runs", "name"])
      .default("minutes"),
  )
  .addOption(
    new Option("--group-by <field>", "group results by field")
      .choices(["actor"])
  )
  .option("--include-forks", "include forked repos when scanning an org")
  .option("--include-archived", "include archived repos when scanning an org")
  .option("--csv <path>", "export CSV to file")
  .option("--markdown-file <path>", "export markdown to file (in addition to primary format)")
  .action(async (opts) => {
    try {
      const options: CliOptions = {
        repos: opts.repo ?? [],
        org: opts.org,
        exclude: opts.exclude,
        groupBy: opts.groupBy,
        since: opts.since ?? startOfMonthStr(),
        until: opts.until ?? todayStr(),
        format: opts.format ?? "table",
        sort: opts.sort ?? "minutes",
        csv: opts.csv,
        markdownFile: opts.markdownFile,
        includeForks: opts.includeForks,
        includeArchived: opts.includeArchived,
      };

      await checkGhCli();

      const resolved = await resolveRepos(options.org, options.repos, {
        exclude: options.exclude,
        includeForks: options.includeForks,
        includeArchived: options.includeArchived,
      });
      const resolveLog = formatResolveLog(resolved, options.org);
      if (resolveLog) process.stderr.write(resolveLog + "\n");
      options.repos = resolved.repos;

      const results = await fetchRuns(options.repos, options.since, options.until);
      const runs = results.flatMap((r) => r.runs);

      for (const r of results) {
        for (const warning of r.warnings) {
          process.stderr.write(`  Warning: ${warning}\n`);
        }
      }

      if (runs.length === 0) {
        process.stderr.write("No completed runs found in this period.\n");
        process.exit(EXIT_NO_DATA);
      }

      process.stderr.write(`\nTotal: ${runs.length} completed runs\n\n`);

      let data = aggregate(
        runs,
        options.repos,
        options.since,
        options.until,
        options.sort,
      );

      if (options.groupBy === "actor") {
        data = groupByActor(data, options.sort);
      }

      if (options.csv) {
        renderCsv(data, options.csv);
      }

      if (options.markdownFile) {
        renderMarkdown(data, options.markdownFile);
      }

      switch (options.format) {
        case "csv":
          renderCsv(data);
          break;
        case "json":
          renderJson(data);
          break;
        case "markdown":
          renderMarkdown(data);
          break;
        default:
          renderTable(data);
      }
    } catch (err) {
      const [msg, ...causes] = causeChain(err);
      process.stderr.write(`Error: ${msg}\n`);
      for (const cause of causes) {
        process.stderr.write(`  Caused by: ${cause}\n`);
      }
      process.exit(EXIT_ERROR);
    }
  });

async function main(): Promise<void> {
  await program.parseAsync();
}

main();
