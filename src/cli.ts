import path from "node:path";
import { readEpisode } from "./episode.js";
import { UserError } from "./errors.js";
import { renderEpisode } from "./render.js";
import { checkEpisodeForRender, errorsIn, type Problem } from "./validation.js";

const USAGE = "Usage: pnpm render <episode-folder>";

async function render(folderArg: string | undefined): Promise<void> {
  if (!folderArg) throw new UserError(USAGE);
  // `pnpm render` runs from the repo root; INIT_CWD is where the user typed the command.
  const episode = await readEpisode(path.resolve(process.env.INIT_CWD ?? process.cwd(), folderArg));

  const problems = checkEpisodeForRender(episode);
  report(problems);
  if (errorsIn(problems).length > 0) throw new UserError("Render refused.");

  const result = await renderEpisode(episode, { log: (line) => console.log(line) });
  console.log(`Video:      ${result.video}`);
  console.log(`Timestamps: ${result.timestamps}`);
}

function report(problems: Problem[]): void {
  for (const p of problems) console.error(`${p.severity === "error" ? "Error" : "Warning"}: ${p.message}`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "render":
      return render(rest[0]);
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
