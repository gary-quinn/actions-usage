import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { WorkflowRun, OrgFilterOptions } from "./types.js";

const execFile = promisify(execFileCb);

export const REPO_CONCURRENCY = 5;
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
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to list repos for org "${org}": ${detail}`);
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
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch runs for ${repo} ${start}..${end}: ${detail}`,
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
      warnings.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  return { repo, runs: allRuns, warnings };
}

// Safe because Node.js is single-threaded: nextIndex++ and the while check
// run synchronously between await points, so no two workers ever claim the
// same index. Each worker yields only at `await fn(...)`.
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
