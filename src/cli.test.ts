import { describe, it, expect } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_SUCCESS, EXIT_ERROR, EXIT_NO_DATA } from "./types.js";

const execFile = promisify(execFileCb);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "..", "dist", "cli.cjs");

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

describe("exit codes", () => {
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
