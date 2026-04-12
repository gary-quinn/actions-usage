import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { WorkflowRun } from "./types.js";

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

export async function fetchOrgRepos(org: string): Promise<readonly string[]> {
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
        ".[] | select(.archived == false and .disabled == false and .fork == false) | .full_name",
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

async function fetchRunsForPeriod(
  repo: string,
  start: string,
  end: string,
): Promise<readonly WorkflowRun[]> {
  try {
    const { stdout } = await execFile(
      "gh",
      [
        "api",
        `/repos/${repo}/actions/runs?created=${start}..${end}&per_page=100&status=completed`,
        "--paginate",
        "--jq",
        JQ_FILTER,
      ],
      { maxBuffer: 50 * 1024 * 1024 },
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
  const startDate = new Date(since);
  const endDate = new Date(until);
  let current = new Date(startDate);

  while (current <= endDate) {
    const year = current.getFullYear();
    const month = current.getMonth();

    const periodStart =
      current.getTime() === startDate.getTime()
        ? since
        : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const periodEnd = monthEnd > until ? until : monthEnd;

    periods.push({ start: periodStart, end: periodEnd });
    current = new Date(year, month + 1, 1);
  }

  return periods;
}

export interface FetchResult {
  readonly repo: string;
  readonly runs: readonly WorkflowRun[];
}

export async function fetchRepoRuns(
  repo: string,
  since: string,
  until: string,
): Promise<FetchResult> {
  const periods = getMonthPeriods(since, until);

  const results = await Promise.all(
    periods.map((period) => fetchRunsForPeriod(repo, period.start, period.end)),
  );

  return { repo, runs: results.flat() };
}

// Safe because Node.js is single-threaded: nextIndex++ and the while check
// run synchronously between await points, so no two workers ever claim the
// same index. Each worker yields only at `await fn(...)`.
async function runWithConcurrency<T, R>(
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
