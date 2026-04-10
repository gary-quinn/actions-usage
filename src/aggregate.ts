import type { WorkflowRun, UserStats, AggregatedData } from "./types.js";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr);
  return MONTH_NAMES[date.getUTCMonth()];
}

function getDurationMinutes(startedAt: string, updatedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  return Math.max(0, (end - start) / 60_000);
}

export function aggregate(
  runs: WorkflowRun[],
  repo: string,
  since: string,
  until: string,
  sortBy: "minutes" | "runs" | "name",
): AggregatedData {
  const userMap = new Map<string, UserStats>();
  const workflowMap = new Map<string, { minutes: number; runs: number }>();
  const monthSet = new Set<string>();

  for (const run of runs) {
    const duration = getDurationMinutes(run.startedAt, run.updatedAt);
    const month = getMonthKey(run.startedAt);
    monthSet.add(month);

    // Per user
    let user = userMap.get(run.actor);
    if (!user) {
      user = {
        actor: run.actor,
        totalMinutes: 0,
        totalRuns: 0,
        monthlyMinutes: {},
        workflows: {},
      };
      userMap.set(run.actor, user);
    }
    user.totalMinutes += duration;
    user.totalRuns += 1;
    user.monthlyMinutes[month] = (user.monthlyMinutes[month] ?? 0) + duration;

    if (!user.workflows[run.workflow]) {
      user.workflows[run.workflow] = { minutes: 0, runs: 0 };
    }
    user.workflows[run.workflow].minutes += duration;
    user.workflows[run.workflow].runs += 1;

    // Per workflow (normalize dependabot names)
    const wfName =
      run.workflow.includes("npm_and_yarn") ||
      run.workflow.includes("gradle") ||
      run.workflow.includes("github_actions")
        ? "Dependabot updates"
        : run.workflow;

    const wf = workflowMap.get(wfName) ?? { minutes: 0, runs: 0 };
    wf.minutes += duration;
    wf.runs += 1;
    workflowMap.set(wfName, wf);
  }

  // Sort users
  const users = [...userMap.values()].sort((a, b) => {
    switch (sortBy) {
      case "runs":
        return b.totalRuns - a.totalRuns;
      case "name":
        return a.actor.localeCompare(b.actor);
      default:
        return b.totalMinutes - a.totalMinutes;
    }
  });

  // Order months chronologically
  const months = MONTH_NAMES.filter((m) => monthSet.has(m));

  // Totals
  const totals = {
    minutes: users.reduce((sum, u) => sum + u.totalMinutes, 0),
    runs: users.reduce((sum, u) => sum + u.totalRuns, 0),
    monthly: {} as Record<string, number>,
  };
  for (const m of months) {
    totals.monthly[m] = users.reduce(
      (sum, u) => sum + (u.monthlyMinutes[m] ?? 0),
      0,
    );
  }

  // Sorted workflows
  const workflows = [...workflowMap.entries()]
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.minutes - a.minutes);

  return { repo, since, until, months, users, totals, workflows };
}
