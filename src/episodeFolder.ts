import { readdir } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";

const BACKGROUND_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Image files at the top level of the Episode Folder (so nothing inside out/ is an input). */
export async function findBackgroundCandidates(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && BACKGROUND_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(folder, e.name))
    .sort();
}

export async function findBackground(folder: string): Promise<string> {
  const candidates = await findBackgroundCandidates(folder);
  if (candidates.length !== 1) {
    throw new UserError(`Expected exactly one Background image in ${folder}, found ${candidates.length}.`);
  }
  return candidates[0]!;
}
