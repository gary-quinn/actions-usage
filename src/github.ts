import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { WorkflowRun, OrgFilterOptions } from "./types.js";
import type { RunTiming, RunnerOs } from "./billing.js";
import { causeChain } from "./errors.js";

const execFile = promisify(execFileCb);

export const REPO_CONCURRENCY = 5;
// GitHub REST API allows 5000 req/hour; 10 keeps us well under even with
// retries, while still finishing 50+ run PRs in reasonable time.
const TIMING_CONCURRENCY = 10;
export const LARGE_ORG_THRESHOLD = 50;

const REPO_FORMAT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const ORG_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export function validateRepoFormat(repo: string): void {
  if (!REPO_FORMAT.test(repo)) {
    throw new Error(
      `Invalid repo format: "${repo}". Expected owner/repo (e.g. "my-org/my-app")`,
    );
  }
}

function validateOrgName(org: string): void {
  if (!ORG_NAME.test(org)) {
    throw new Error(
      `Invalid org name: "${org}". Expected alphanumeric with hyphens (e.g. "my-org")`,
    );
  }
}

const parseStdout = (stdout: string): readonly string[] =>
  stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim());

export async function detectRepo(): Promise<string> {
  let url: string;
  try {
    const { stdout } = await execFile("git", ["remote", "get-url", "origin"]);
    url = stdout.trim();
  } catch {
    throw new Error(
      "Could not detect repo from git remote. Use --repo owner/repo",
    );
  }

  const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  throw new Error(`Could not parse repo from remote URL: ${url}`);
}

export async function checkGhCli(): Promise<void> {
  try {
    await execFile("gh", ["auth", "status"]);
  } catch {
    throw new Error(
      "GitHub CLI (gh) is not installed or not authenticated.\n" +
        "Install: https://cli.github.com\n" +
        "Auth:    gh auth login",
    );
  }
}

function buildOrgJqFilter(options: OrgFilterOptions = {}): string {
  const conditions = [".disabled == false"];
  if (!options.includeArchived) conditions.push(".archived == false");
  if (!options.includeForks) conditions.push(".fork == false");
  return `.[] | select(${conditions.join(" and ")}) | .full_name`;
}

export async function fetchOrgRepos(
  org: string,
  options: OrgFilterOptions = {},
): Promise<readonly string[]> {
  validateOrgName(org);

  let stdout: string;
  try {
    ({ stdout } = await execFile(
      "gh",
      [
        "api",
        `/orgs/${org}/repos?per_page=100`,
        "--paginate",
        "--jq",
        buildOrgJqFilter(options),
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    ));
  } catch (err) {
    throw new Error(`Failed to list repos for org "${org}"`, { cause: err });
  }

  const repos = parseStdout(stdout);

  if (repos.length === 0) {
    throw new Error(`No accessible repositories found in org "${org}"`);
  }

  return [...repos].sort();
}

interface RawRun {
  readonly id: number;
  readonly actor: string;
  readonly workflow: string;
  readonly started: string;
  readonly updated: string;
}

const JQ_FILTER =
  ".workflow_runs[] | {id: .id, actor: .triggering_actor.login, workflow: .name, started: .run_started_at, updated: .updated_at}";

const parseRunLine =
  (repo: string) =>
  (line: string): WorkflowRun => {
    const raw = JSON.parse(line) as RawRun;
    return {
      id: raw.id,
      repo,
      actor: raw.actor,
      workflow: raw.workflow,
      startedAt: raw.started,
      updatedAt: raw.updated,
    };
  };

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("secondary rate limit");
}

/**
 * Retry a function on rate limit errors with exponential backoff.
 * @param fn - async function to execute
 * @param retries - number of retry attempts (not counting the initial call)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  const totalAttempts = retries + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < totalAttempts && isRateLimitError(err)) {
        const jitter = 0.5 + Math.random() * 0.5;
        const delay = Math.round(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1) * jitter);
        process.stderr.write(`  Rate limited, retrying in ${delay}ms (attempt ${attempt}/${retries})...\n`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

async function fetchRunsForPeriod(
  repo: string,
  start: string,
  end: string,
): Promise<readonly WorkflowRun[]> {
  try {
    const { stdout } = await withRetry(() =>
      execFile(
        "gh",
        [
          "api",
          `/repos/${repo}/actions/runs?created=${start}..${end}&per_page=100&status=completed`,
          "--paginate",
          "--jq",
          JQ_FILTER,
        ],
        { maxBuffer: 50 * 1024 * 1024 },
      ),
    );

    return parseStdout(stdout).map(parseRunLine(repo));
  } catch (err) {
    throw new Error(
      `Failed to fetch runs for ${repo} ${start}..${end}`,
      { cause: err },
    );
  }
}

export function getMonthPeriods(
  since: string,
  until: string,
): readonly { readonly start: string; readonly end: string }[] {
  const periods: { start: string; end: string }[] = [];
  // Parse as UTC — date-only strings (YYYY-MM-DD) are UTC per spec,
  // so all arithmetic must use UTC methods to avoid timezone drift.
  const startDate = new Date(since);
  const endDate = new Date(until);
  let current = new Date(startDate);

  while (current <= endDate) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();

    const periodStart =
      current.getTime() === startDate.getTime()
        ? since
        : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const periodEnd = monthEnd > until ? until : monthEnd;

    periods.push({ start: periodStart, end: periodEnd });
    current = new Date(Date.UTC(year, month + 1, 1));
  }

  return periods;
}

export interface FetchResult {
  readonly repo: string;
  readonly runs: readonly WorkflowRun[];
  readonly warnings: readonly string[];
}

export async function fetchRepoRuns(
  repo: string,
  since: string,
  until: string,
): Promise<FetchResult> {
  const periods = getMonthPeriods(since, until);
  const allRuns: WorkflowRun[] = [];
  const warnings: string[] = [];

  const settled = await Promise.allSettled(
    periods.map((period) => fetchRunsForPeriod(repo, period.start, period.end)),
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      allRuns.push(...result.value);
    } else {
      warnings.push(causeChain(result.reason).join(": "));
    }
  }

  return { repo, runs: allRuns, warnings };
}

// Worker-pool: no lock needed because there is no `await` between reading
// and incrementing nextIndex. Adding an await there would break this.
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function fetchMultiRepoRuns(
  repos: readonly string[],
  since: string,
  until: string,
): Promise<readonly FetchResult[]> {
  return runWithConcurrency(repos, REPO_CONCURRENCY, (repo) =>
    fetchRepoRuns(repo, since, until),
  );
}

// --- Per-PR cost tracking ---

async function fetchPrHeadBranch(repo: string, pr: number): Promise<string> {
  try {
    const { stdout } = await withRetry(() =>
      execFile("gh", [
        "api",
        `/repos/${repo}/pulls/${pr}`,
        "--jq",
        ".head.ref",
      ]),
    );
    const branch = stdout.trim();
    if (!branch) {
      throw new Error(`PR #${pr} returned empty head branch`);
    }
    return branch;
  } catch (err) {
    throw new Error(`Failed to fetch PR #${pr} head branch for ${repo}`, {
      cause: err,
    });
  }
}

export async function fetchPrRuns(
  repo: string,
  pr: number,
): Promise<readonly WorkflowRun[]> {
  validateRepoFormat(repo);

  const branch = await fetchPrHeadBranch(repo, pr);

  try {
    const { stdout } = await withRetry(() =>
      execFile(
        "gh",
        [
          "api",
          `/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=pull_request&per_page=100&status=completed`,
          "--paginate",
          "--jq",
          JQ_FILTER,
        ],
        { maxBuffer: 50 * 1024 * 1024 },
      ),
    );

    return parseStdout(stdout).map(parseRunLine(repo));
  } catch (err) {
    throw new Error(`Failed to fetch PR #${pr} runs for ${repo}`, {
      cause: err,
    });
  }
}

interface RawTiming {
  readonly UBUNTU: number;
  readonly MACOS: number;
  readonly WINDOWS: number;
}

const TIMING_JQ_FILTER =
  ".billable | {UBUNTU: (.UBUNTU.total_ms // 0), MACOS: (.MACOS.total_ms // 0), WINDOWS: (.WINDOWS.total_ms // 0)}";

export async function fetchRunTiming(
  repo: string,
  run: WorkflowRun,
): Promise<RunTiming> {
  try {
    const { stdout } = await withRetry(() =>
      execFile("gh", [
        "api",
        `/repos/${repo}/actions/runs/${run.id}/timing`,
        "--jq",
        TIMING_JQ_FILTER,
      ]),
    );

    const raw = JSON.parse(stdout.trim()) as RawTiming;
    const billable: Record<RunnerOs, number> = {
      UBUNTU: raw.UBUNTU / 60_000,
      MACOS: raw.MACOS / 60_000,
      WINDOWS: raw.WINDOWS / 60_000,
    };

    return { runId: run.id, workflow: run.workflow, billable };
  } catch (err) {
    throw new Error(`Failed to fetch timing for run ${run.id} in ${repo}`, {
      cause: err,
    });
  }
}

// --- Jobs-based fallback for zero-billable orgs ---

interface RawJob {
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly labels: readonly string[];
}

const JOBS_JQ_FILTER =
  "[.jobs[] | {started_at, completed_at, labels}]";

/**
 * Map runner labels to OS. First recognized label wins (left-to-right scan).
 * Matches GitHub-hosted patterns (e.g. `ubuntu-latest`, `macos-14`, `windows-2022`)
 * and self-hosted labels (e.g. `linux`, `windows`). Unrecognized labels default to UBUNTU.
 */
export function labelToOs(labels: readonly string[]): RunnerOs {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "windows" || lower.startsWith("windows-")) return "WINDOWS";
    if (lower === "macos" || lower.startsWith("macos-")) return "MACOS";
    if (lower === "linux" || lower.startsWith("linux-") ||
        lower === "ubuntu" || lower.startsWith("ubuntu-")) return "UBUNTU";
  }
  return "UBUNTU";
}

export function computeJobMinutes(jobs: readonly RawJob[]): Record<RunnerOs, number> {
  const minutes: Record<RunnerOs, number> = { UBUNTU: 0, MACOS: 0, WINDOWS: 0 };

  for (const job of jobs) {
    if (!job.started_at || !job.completed_at) continue;
    const start = new Date(job.started_at).getTime();
    const end = new Date(job.completed_at).getTime();
    const durationMs = end - start;
    if (durationMs <= 0) continue;
    const os = labelToOs(job.labels);
    minutes[os] += durationMs / 60_000;
  }

  return minutes;
}

export async function fetchRunJobsDuration(
  repo: string,
  runId: number,
): Promise<Record<RunnerOs, number>> {
  const { stdout } = await withRetry(() =>
    execFile("gh", [
      "api",
      `/repos/${repo}/actions/runs/${runId}/jobs`,
      "--paginate",
      "--jq",
      JOBS_JQ_FILTER,
    ]),
  );

  // --paginate with --jq outputs one JSON array per page, concatenated
  const jobs = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => JSON.parse(line) as RawJob[]);

  return computeJobMinutes(jobs);
}

/**
 * Returns true when at least one run has non-zero billable minutes,
 * meaning the billing API returned useful data. Returns false when
 * timings are empty or every run reports zero — indicating the org's
 * plan includes minutes and a fallback is needed.
 */
export function hasBillableData(timings: readonly RunTiming[]): boolean {
  if (timings.length === 0) return false;
  return timings.some((t) =>
    t.billable.UBUNTU > 0 || t.billable.MACOS > 0 || t.billable.WINDOWS > 0,
  );
}

export interface TimingResult {
  readonly timings: readonly RunTiming[];
  readonly warnings: readonly string[];
  readonly estimated: boolean;
}

export async function fetchPrTimings(
  repo: string,
  runs: readonly WorkflowRun[],
): Promise<TimingResult> {
  // runWithConcurrency throws on first error; we need settled semantics
  // (collect successes + warnings) so we catch per-item and return the
  // standard PromiseSettledResult shape.
  const settled = await runWithConcurrency(
    runs,
    TIMING_CONCURRENCY,
    async (run): Promise<PromiseSettledResult<RunTiming>> => {
      try {
        return { status: "fulfilled", value: await fetchRunTiming(repo, run) };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    },
  );

  const timings: RunTiming[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      timings.push(result.value);
    } else {
      warnings.push(causeChain(result.reason).join(": "));
    }
  }

  if (hasBillableData(timings)) {
    return { timings, warnings, estimated: false };
  }

  // Billable API returned 0 for all runs — fall back to job durations
  const fallbackTimings: RunTiming[] = [];

  const jobResults = await runWithConcurrency(
    timings,
    TIMING_CONCURRENCY,
    async (t): Promise<RunTiming | null> => {
      try {
        const billable = await fetchRunJobsDuration(repo, t.runId);
        return { runId: t.runId, workflow: t.workflow, billable };
      } catch (err) {
        warnings.push(causeChain(err).join(": "));
        return null;
      }
    },
  );

  for (const result of jobResults) {
    if (result) fallbackTimings.push(result);
  }

  return { timings: fallbackTimings, warnings, estimated: true };
}
