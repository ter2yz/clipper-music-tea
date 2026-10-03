import { spawn } from "node:child_process";
import path from "node:path";
import { UserError } from "./errors.js";
import { startPreviewServer } from "./preview/server.js";
import { renderEpisode } from "./render.js";
import { checkEpisodeFolder, errorsIn, type Problem } from "./validation.js";

const USAGE = "Usage: pnpm render <episode-folder>\n       pnpm preview <episode-folder> [--no-open]";

/** `pnpm <command>` runs from the repo root; INIT_CWD is where the user typed the command. */
function episodeFolderArg(folderArg: string | undefined): string {
  if (!folderArg) throw new UserError(USAGE);
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), folderArg);
}

async function render(folderArg: string | undefined): Promise<void> {
  const { episode, problems } = await checkEpisodeFolder(episodeFolderArg(folderArg));
  report(problems);
  if (!episode || errorsIn(problems).length > 0) throw new UserError("Render refused.");

  const result = await renderEpisode(episode, { log: (line) => console.log(line) });
  console.log(`Video:      ${result.video}`);
  console.log(`Timestamps: ${result.timestamps}`);
}

async function preview(args: string[]): Promise<void> {
  const open = !args.includes("--no-open");
  const positional = args.filter((a) => a !== "--no-open");
  if (positional.length !== 1 || positional[0]!.startsWith("-")) throw new UserError(USAGE);
  const folder = episodeFolderArg(positional[0]);

  const server = await startPreviewServer(folder);
  console.log(`Preview of ${folder}`);
  console.log(`  ${server.url}`);
  console.log("Edit episode.yaml and save; the page reloads. Ctrl+C to stop.");
  if (open) openInBrowser(server.url);

  await new Promise<void>((resolve) => {
    const stop = () => void server.close().catch(console.error).finally(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** Opens `url` in the user's default browser; if that fails, the printed URL is still there. */
function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => console.error(`Couldn't open a browser; open ${url} yourself.`));
  child.unref();
}

function report(problems: Problem[]): void {
  for (const p of problems) console.error(`${p.severity === "error" ? "Error" : "Warning"}: ${p.message}`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "render":
      return render(rest[0]);
    case "preview":
      return preview(rest);
    default:
      throw new UserError(USAGE);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UserError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
