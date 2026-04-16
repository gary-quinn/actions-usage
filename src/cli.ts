import { Command, Option } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkGhCli,
  fetchRepoRuns,
  fetchMultiRepoRuns,
  fetchPrRuns,
  fetchPrTimings,
  LARGE_ORG_THRESHOLD,
} from "./github.js";
import type { FetchResult } from "./github.js";
import { resolveRepos, formatResolveLog } from "./resolve.js";
import { aggregate, groupByActor } from "./aggregate.js";
import { aggregatePrCost } from "./billing.js";
import { renderTable, renderCsv, renderJson, renderMarkdown, renderPrCostMarkdown, renderPrCostJson, formatRepoDisplay, formatFetchSummary } from "./output.js";
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

async function runPrCost(options: CliOptions): Promise<void> {
  const pr = options.pr!;
  if (options.repos.length !== 1) {
    throw new Error("--pr requires exactly one repository (use --repo owner/repo)");
  }
  const repo = options.repos[0];

  process.stderr.write(`Fetching CI runs for ${repo} PR #${pr}...\n`);
  const prRuns = await fetchPrRuns(repo, pr);

  if (prRuns.length === 0) {
    process.stderr.write(`No completed workflow runs found for PR #${pr}.\n`);
    process.exit(EXIT_NO_DATA);
  }

  process.stderr.write(`Found ${prRuns.length} run${prRuns.length !== 1 ? "s" : ""}, fetching billing data...\n`);
  const { timings, warnings, estimated } = await fetchPrTimings(repo, prRuns, options.selfHostedRate);

  if (estimated) {
    process.stderr.write(`  Billable minutes are 0 — fetched job durations for ${timings.length} run${timings.length !== 1 ? "s" : ""} as fallback\n`);
  }

  for (const warning of warnings) {
    process.stderr.write(`  Warning: ${warning}\n`);
  }

  if (timings.length === 0) {
    const detail = estimated
      ? "Billing API returned 0 minutes and job duration fallback also failed."
      : "Could not fetch billing data for any run.";
    process.stderr.write(`${detail}\n`);
    process.exit(EXIT_NO_DATA);
  }

  const summary = aggregatePrCost(timings, pr, repo, estimated);
  const markdown = renderPrCostMarkdown(summary);

  if (options.markdownFile) {
    writeFileSync(options.markdownFile, markdown, "utf-8");
    process.stderr.write(`Markdown written to ${options.markdownFile}\n`);
  }

  if (options.format === "json") {
    process.stdout.write(renderPrCostJson(summary));
  } else {
    process.stdout.write(markdown);
  }
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
  .option("--pr <number>", "show CI cost for a specific pull request", (val: string) => {
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`--pr must be a positive integer, got "${val}"`);
    }
    return n;
  })
  .option("--include-forks", "include forked repos when scanning an org")
  .option("--include-archived", "include archived repos when scanning an org")
  .option("--self-hosted-rate <rate>", "per-minute rate (USD) for self-hosted runners (default: 0)", (val: string) => {
    const n = Number(val);
    if (isNaN(n) || n < 0) {
      throw new Error(`--self-hosted-rate must be a non-negative number, got "${val}"`);
    }
    return n;
  })
  .option("--csv <path>", "export CSV to file")
  .option("--markdown-file <path>", "export markdown to file (in addition to primary format)")
  .action(async (opts) => {
    try {
      const options: CliOptions = {
        repos: opts.repo ?? [],
        org: opts.org,
        exclude: opts.exclude,
        groupBy: opts.groupBy,
        pr: opts.pr,
        since: opts.since ?? startOfMonthStr(),
        until: opts.until ?? todayStr(),
        format: opts.format ?? "table",
        sort: opts.sort ?? "minutes",
        csv: opts.csv,
        markdownFile: opts.markdownFile,
        includeForks: opts.includeForks,
        includeArchived: opts.includeArchived,
        selfHostedRate: opts.selfHostedRate,
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

      if (options.pr !== undefined) {
        await runPrCost(options);
        return;
      }

      // --- Standard usage report mode ---
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
