import { execSync } from "node:child_process";
import type { WorkflowRun } from "./types.js";

export function detectRepo(): string {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Handle SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];

    // Handle HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];

    throw new Error(`Could not parse repo from remote URL: ${url}`);
  } catch {
    throw new Error(
      "Could not detect repo from git remote. Use --repo owner/repo",
    );
  }
}

export function checkGhCli(): void {
  try {
    execSync("gh auth status", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "GitHub CLI (gh) is not installed or not authenticated.\n" +
        "Install: https://cli.github.com\n" +
        "Auth:    gh auth login",
    );
  }
}

interface GitHubWorkflowRun {
  id: number;
  triggering_actor: { login: string };
  name: string;
  run_started_at: string;
  updated_at: string;
}

function fetchRunsForPeriod(
  repo: string,
  start: string,
  end: string,
): WorkflowRun[] {
  const jqFilter =
    ".workflow_runs[] | {id: .id, actor: .triggering_actor.login, workflow: .name, started: .run_started_at, updated: .updated_at}";

  try {
    const result = execSync(
      `gh api "/repos/${repo}/actions/runs?created=${start}..${end}&per_page=100&status=completed" --paginate --jq '${jqFilter}'`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    return result
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const raw = JSON.parse(line) as {
          id: number;
          actor: string;
          workflow: string;
          started: string;
          updated: string;
        };
        return {
          id: raw.id,
          actor: raw.actor,
          workflow: raw.workflow,
          startedAt: raw.started,
          updatedAt: raw.updated,
        };
      });
  } catch {
    return [];
  }
}

function getMonthPeriods(
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

export function fetchAllRuns(
  repo: string,
  since: string,
  until: string,
): WorkflowRun[] {
  const periods = getMonthPeriods(since, until);
  const allRuns: WorkflowRun[] = [];

  for (const period of periods) {
    const monthLabel = period.start.slice(0, 7);
    process.stderr.write(`  Fetching ${monthLabel}...`);
    const runs = fetchRunsForPeriod(repo, period.start, period.end);
    process.stderr.write(` ${runs.length} runs\n`);
    allRuns.push(...runs);
  }

  return allRuns;
}
