import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI exactly as `pnpm <command> ...` would, and never throws on a non-zero exit. */
export function runCli(...args: string[]): Promise<CliResult> {
  const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
  return new Promise((resolve) => {
    execFile(tsx, [path.join(repoRoot, "src", "cli.ts"), ...args], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ exitCode, stdout, stderr });
    });
  });
}
