import type { WorkflowRun, UserStats, AggregatedData } from "./types.js";

export function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getDurationMinutes(startedAt: string, updatedAt: string): number {
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

    const wf = workflowMap.get(run.workflow) ?? { minutes: 0, runs: 0 };
    wf.minutes += duration;
    wf.runs += 1;
    workflowMap.set(run.workflow, wf);
  }

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

  const months = [...monthSet].sort();

  const totals = {
    minutes: users.reduce((sum, u) => sum + u.totalMinutes, 0),
    runs: users.reduce((sum, u) => sum + u.totalRuns, 0),
    monthly: Object.fromEntries(
      months.map((m) => [
        m,
        users.reduce((sum, u) => sum + (u.monthlyMinutes[m] ?? 0), 0),
      ]),
    ),
  };

  const workflows = [...workflowMap.entries()]
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.minutes - a.minutes);

  return { repo, since, until, months, users, totals, workflows };
}
