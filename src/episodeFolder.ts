import { readdir } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";

const BACKGROUND_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const TRACK_EXTENSION = ".mp3";

/** The input files of an Episode Folder, by name. Only the top level counts, so nothing in out/ is an input. */
export interface EpisodeFolderContents {
  tracks: string[];
  backgroundCandidates: string[];
}

export async function listEpisodeFolder(folder: string): Promise<EpisodeFolderContents> {
  let names: string[];
  try {
    names = (await readdir(folder, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new UserError(`No Episode Folder at ${folder}.`);
    throw error;
  }
  const extension = (name: string) => path.extname(name).toLowerCase();
  return {
    tracks: names.filter((n) => extension(n) === TRACK_EXTENSION),
    backgroundCandidates: names.filter((n) => BACKGROUND_EXTENSIONS.has(extension(n))),
  };
}

/** The Background of an Episode Folder that has already passed validation. */
export async function findBackground(folder: string): Promise<string> {
  const { backgroundCandidates } = await listEpisodeFolder(folder);
  if (backgroundCandidates.length !== 1) {
    throw new UserError(`Expected exactly one Background image in ${folder}, found ${backgroundCandidates.length}.`);
  }
  return path.join(folder, backgroundCandidates[0]!);
}
