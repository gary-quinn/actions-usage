import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { WorkflowRun } from "./types.js";

const execFile = promisify(execFileCb);

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

interface RawRun {
  id: number;
  actor: string;
  workflow: string;
  started: string;
  updated: string;
}

const JQ_FILTER =
  ".workflow_runs[] | {id: .id, actor: .triggering_actor.login, workflow: .name, started: .run_started_at, updated: .updated_at}";

async function fetchRunsForPeriod(
  repo: string,
  start: string,
  end: string,
): Promise<WorkflowRun[]> {
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

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const raw = JSON.parse(line) as RawRun;
        return {
          id: raw.id,
          actor: raw.actor,
          workflow: raw.workflow,
          startedAt: raw.started,
          updatedAt: raw.updated,
        };
      });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  Warning: failed to fetch runs for ${start}..${end}: ${detail}\n`);
    return [];
  }
}

export function getMonthPeriods(
  since: string,
  until: string,
): { start: string; end: string }[] {
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

export async function fetchAllRuns(
  repo: string,
  since: string,
  until: string,
): Promise<WorkflowRun[]> {
  const periods = getMonthPeriods(since, until);

  const results = await Promise.all(
    periods.map((period) => fetchRunsForPeriod(repo, period.start, period.end)),
  );

  for (let i = 0; i < periods.length; i++) {
    process.stderr.write(
      `  ${periods[i].start.slice(0, 7)}: ${results[i].length} runs\n`,
    );
  }

  return results.flat();
}
