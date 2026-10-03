import { EPISODE_FILE, type Episode } from "./episode.js";

/**
 * Something wrong with an Episode. Errors stop a render; warnings are reported but
 * don't (Preview shows both as warnings).
 */
export interface Problem {
  severity: "error" | "warning";
  message: string;
}

/**
 * Every check that runs before a render. Each rule adds to the list rather than
 * stopping at the first failure, so the user can fix everything in one pass.
 */
export function checkEpisodeForRender(episode: Episode): Problem[] {
  const problems: Problem[] = [];
  if (!episode.approved) {
    problems.push({
      severity: "error",
      message: `${EPISODE_FILE} is not approved. Review the Tracklist, then set \`approved: true\` to render.`,
    });
  }
  return problems;
}

export function errorsIn(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.severity === "error");
}
