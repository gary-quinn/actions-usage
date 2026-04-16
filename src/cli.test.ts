import { describe, it, expect, vi, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_SUCCESS, EXIT_ERROR, EXIT_NO_DATA } from "./types.js";
import { run, renderForFormat } from "./cli.js";
import type { AggregatedData } from "./types.js";

const execFile = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "..", "dist", "main.cjs");

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFileCb("node", [CLI_PATH, ...args], (error, stdout, stderr) => {
      resolve({
        code: error?.code === undefined ? 0 : (typeof error.code === "number" ? error.code : 1),
        stdout,
        stderr,
      });
    });
  });
}

async function hasGhAuth(): Promise<boolean> {
  try {
    await execFile("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

function captureStderr(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe("exit codes (subprocess)", () => {
  it("exports correct exit code constants", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_ERROR).toBe(1);
    expect(EXIT_NO_DATA).toBe(2);
  });

  it("exits 2 when no workflow runs found", async () => {
    if (!(await hasGhAuth())) return; // skip without gh auth

    const result = await runCli([
      "--repo", "gary-quinn/actions-usage",
      "--since", "2020-01-01",
      "--until", "2020-01-02",
      "--format", "json",
    ]);

    expect(result.code).toBe(EXIT_NO_DATA);
    expect(result.stderr).toContain("No completed runs");
    expect(result.stdout).toBe("");
  }, 30_000);

  it("exits 1 on invalid arguments", async () => {
    const result = await runCli([
      "--format", "invalid-format",
    ]);

    expect(result.code).toBe(EXIT_ERROR);
  });
});

describe("run() in-process", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns EXIT_ERROR with message for invalid date format", async () => {
    const { calls, restore } = captureStderr();
    const code = await run(["node", "cli", "--repo", "a/b", "--since", "banana"]);
    restore();
    expect(code).toBe(EXIT_ERROR);
    expect(calls.join("")).toContain("Invalid date format");
  });

  it("returns EXIT_ERROR with message for rolled dates", async () => {
    const { calls, restore } = captureStderr();
    const code = await run(["node", "cli", "--repo", "a/b", "--since", "2025-02-30"]);
    restore();
    expect(code).toBe(EXIT_ERROR);
    expect(calls.join("")).toContain("Invalid date");
  });

  it("returns EXIT_ERROR with message for reversed date range", async () => {
    const { calls, restore } = captureStderr();
    const code = await run(["node", "cli", "--repo", "a/b", "--since", "2025-12-01", "--until", "2025-01-01"]);
    restore();
    expect(code).toBe(EXIT_ERROR);
    expect(calls.join("")).toContain("Invalid date range");
  });

  it("returns EXIT_ERROR for unknown options", async () => {
    const { restore } = captureStderr();
    const code = await run(["node", "cli", "--bogus"]);
    restore();
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("renderForFormat", () => {
  const minimalData: AggregatedData = {
    repos: ["org/repo"],
    since: "2025-01-01",
    until: "2025-01-31",
    months: ["2025-01"],
    users: [],
    totals: { minutes: 0, runs: 0, monthly: {} },
    workflows: [],
  };

  it("returns CSV for csv format", () => {
    const output = renderForFormat("csv", minimalData);
    expect(output).toContain("developer,total_minutes");
  });

  it("returns JSON for json format", () => {
    const output = renderForFormat("json", minimalData);
    const parsed = JSON.parse(output);
    expect(parsed.repos).toEqual(["org/repo"]);
  });

  it("returns markdown for markdown format", () => {
    const output = renderForFormat("markdown", minimalData);
    expect(output).toContain("## GitHub Actions Usage Report");
  });

  it("returns table for table format", () => {
    const output = renderForFormat("table", minimalData);
    expect(output).toContain("Developer");
    expect(output).toContain("TOTAL");
  });
});
