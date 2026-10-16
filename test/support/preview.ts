import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface RunningPreview {
  url: string;
  /** Everything the CLI has printed so far. */
  output(): string;
  stop(): Promise<void>;
}

const running = new Set<RunningPreview>();

/** Starts `pnpm preview <folder> --no-open` and resolves once it prints the page's URL. */
export function startPreview(folder: string): Promise<RunningPreview> {
  const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const child = spawn(tsx, [path.join(repoRoot, "src", "cli.ts"), "preview", folder, "--no-open"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /https?:\/\/\S+/.exec(output);
      if (!match) return;
      child.stdout!.off("data", onData);
      child.stdout!.on("data", (more: Buffer) => (output += more.toString()));
      const preview: RunningPreview = {
        url: match[0],
        output: () => output,
        stop: async () => {
          running.delete(preview);
          await stopProcess(child, exited);
        },
      };
      running.add(preview);
      resolve(preview);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    void exited.then(() => reject(new Error(`preview exited before printing its URL:\n${output}`)));
  });
}

async function stopProcess(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10_000));
  if ((await Promise.race([exited, timeout])) === "timeout") {
    child.kill("SIGKILL");
    throw new Error("preview did not exit within 10 s of SIGTERM");
  }
}

/** Stops every Preview a test started (for afterEach). */
export async function stopAllPreviews(): Promise<void> {
  await Promise.all([...running].map((p) => p.stop()));
}

let browser: Browser | undefined;

/** A fresh page in a shared headless Chromium, sized like a laptop browser window. */
export async function openPage(url: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  browser ??= await chromium.launch();
  const page = await browser.newPage({ viewport });
  await page.goto(url);
  return page;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}
