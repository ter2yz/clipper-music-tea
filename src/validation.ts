import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { isCssColour } from "./cssColour.js";
import { displayName, EPISODE_FILE, type Episode, type TracklistEntry } from "./episode.js";
import { probeWidth } from "./media/ffmpeg.js";
import { charactersFontsCannotDraw, describeCharacter } from "./tracklist/fontCoverage.js";
import { measureTracklistRows } from "./tracklist/measure.js";
import { HOUSE_TRACKLIST_SETTINGS, safeArea, VIDEO_FRAME, type TracklistSettings } from "./tracklist/template.js";
import { listEpisodeFolder, type EpisodeFolderContents } from "./episodeFolder.js";

/**
 * Something wrong with an Episode. Errors stop a render; warnings are reported but
 * don't (Preview shows both as warnings).
 */
export interface Problem {
  severity: "error" | "warning";
  message: string;
}

const MAX_TRACKS = 20;

export interface EpisodeCheck {
  /** The Episode as far as episode.yaml could be read; absent when it can't be read at all. */
  episode: Episode | undefined;
  problems: Problem[];
}

/**
 * Every check on an Episode Folder and its episode.yaml. Each rule adds to the list rather
 * than stopping at the first failure, so the user can fix everything in one pass. Rendering
 * refuses on any error; Preview shows the same list.
 */
export async function checkEpisodeFolder(folder: string): Promise<EpisodeCheck> {
  const contents = await listEpisodeFolder(folder);
  const yaml = await readEpisodeYaml(folder);
  const problems = new ProblemList();
  const { error } = problems;

  await checkBackground(folder, contents, problems);

  if ("problem" in yaml) {
    error(yaml.problem);
    return { episode: undefined, problems: problems.all };
  }
  const doc = yaml.doc;

  if (typeof doc.approved !== "boolean") {
    error(`${EPISODE_FILE}: \`approved\` is required and must be true or false.`);
  } else if (!doc.approved) {
    // Render-only: Preview exists to review an unapproved Tracklist, so it should skip this one.
    error(`${EPISODE_FILE} is not approved. Review the Tracklist, then set \`approved: true\` to render.`);
  }

  const settings = checkEpisodeSettings(doc, error);

  const tracks = Array.isArray(doc.tracks) ? (doc.tracks as unknown[]) : [];
  if (tracks.length === 0) {
    error(`${EPISODE_FILE}: \`tracks\` must list at least one Track.`);
  } else if (tracks.length > MAX_TRACKS) {
    error(`${EPISODE_FILE} lists ${tracks.length} Tracks; an Episode can have at most ${MAX_TRACKS}.`);
  }
  const tracklist = tracks.map((raw, i) => {
    const entry = readTracklistEntry(raw);
    if (entry.missing.length > 0) error(`${EPISODE_FILE}: Track ${i + 1} is missing ${listInWords(entry.missing.map((f) => `\`${f}\``))}.`);
    return entry.entry;
  });
  checkTracksAgainstFolder(tracklist, contents, error);
  await checkDisplayNames(tracklist, settings, error);

  return { episode: { folder, approved: doc.approved === true, ...settings, normalizeLoudness: doc.normalizeLoudness !== false, tracklist }, problems: problems.all };
}

/** Collects Problems; `error` and `warn` can be passed around on their own. */
class ProblemList {
  readonly all: Problem[] = [];
  readonly error = (message: string): void => void this.all.push({ severity: "error", message });
  readonly warn = (message: string): void => void this.all.push({ severity: "warning", message });
}

type Report = (message: string) => void;

export function errorsIn(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.severity === "error");
}

function checkTracksAgainstFolder(tracklist: TracklistEntry[], contents: EpisodeFolderContents, error: Report): void {
  const inFolder = new Set(contents.tracks);
  tracklist.forEach((entry, i) => {
    if (entry.file && !inFolder.has(entry.file)) {
      error(`Track ${i + 1} "${entry.file}" is listed in ${EPISODE_FILE} but there is no such MP3 in the Episode Folder.`);
    }
  });
  const positions = new Map<string, number[]>();
  tracklist.forEach((entry, i) => {
    if (entry.file) positions.set(entry.file, [...(positions.get(entry.file) ?? []), i + 1]);
  });
  for (const [file, tracks] of positions) {
    if (tracks.length > 1) error(`"${file}" is listed more than once in ${EPISODE_FILE} (Tracks ${listInWords(tracks.map(String))}). List each Track once.`);
  }
  const listed = new Set(positions.keys());
  for (const file of contents.tracks) {
    if (!listed.has(file)) {
      error(`"${file}" is in the Episode Folder but not listed in ${EPISODE_FILE}. List it under \`tracks:\` or move it out of the folder.`);
    }
  }
}

/**
 * Text safety: every Display Name must be drawable by the bundled fonts, and every row, with the
 * Now-Playing Marker beside it, must fit inside the frame's safe area. Rows missing a title or
 * artist are already reported and are skipped here.
 */
async function checkDisplayNames(tracklist: TracklistEntry[], settings: TracklistSettings, error: Report): Promise<void> {
  const named = tracklist.flatMap((entry, i) => (entry.title.trim() && entry.artist.trim() ? [{ track: i + 1, name: displayName(entry) }] : []));

  for (const { track, name } of named) {
    const undrawable = charactersFontsCannotDraw(name);
    if (undrawable.length > 0) {
      error(`Track ${track} "${name}" has characters neither Inter nor Noto Sans JP can draw: ${undrawable.map(describeCharacter).join(", ")}. Replace them or write the name another way.`);
    }
  }

  if (named.length === 0) return;
  const safe = safeArea(VIDEO_FRAME);
  const extents = await measureTracklistRows(named.map((row) => row.name), settings, VIDEO_FRAME);
  named.forEach(({ track, name }, i) => {
    const { left, right } = extents[i]!;
    const overflow = Math.ceil(Math.max(safe.left - left, right - safe.right));
    if (overflow > 0) {
      error(`Track ${track} "${name}" is too wide for the frame: with the ▶ it runs ${overflow} px past the safe area. Shorten its title or artist.`);
    }
  });
}

/**
 * Checks the Episode Settings and returns the Tracklist's, with the house style filled in for
 * anything unset — or invalid, so the rest of the checks (and Preview) still have a layout to use.
 */
function checkEpisodeSettings(doc: Record<string, unknown>, error: Report): TracklistSettings {
  const { side, textColor, normalizeLoudness } = doc;
  const settings = { ...HOUSE_TRACKLIST_SETTINGS };
  if (side === "right" || side === "left") {
    settings.side = side;
  } else if (side !== undefined) {
    error(`${EPISODE_FILE}: \`side\` must be "right" or "left", not ${asWrittenInYaml(side)}.`);
  }
  if (typeof textColor === "string" && isCssColour(textColor)) {
    settings.textColor = textColor;
  } else if (textColor !== undefined) {
    error(`${EPISODE_FILE}: \`textColor\` must be a CSS colour such as "#FFFFFF", not ${asWrittenInYaml(textColor)}.`);
  }
  if (normalizeLoudness !== undefined && typeof normalizeLoudness !== "boolean") {
    error(`${EPISODE_FILE}: \`normalizeLoudness\` must be true or false, not ${asWrittenInYaml(normalizeLoudness)}.`);
  }
  return settings;
}

/** A YAML value as the user would recognise it in a message. */
function asWrittenInYaml(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

async function checkBackground(folder: string, { backgroundCandidates }: EpisodeFolderContents, { error, warn }: ProblemList): Promise<void> {
  if (backgroundCandidates.length === 0) {
    error("No Background image in the Episode Folder. Add one .jpg, .jpeg, .png or .webp image.");
    return;
  }
  if (backgroundCandidates.length > 1) {
    error(`Found ${backgroundCandidates.length} Background images in the Episode Folder (${backgroundCandidates.join(", ")}). Keep exactly one.`);
    return;
  }
  const background = backgroundCandidates[0]!;
  let width: number;
  try {
    width = await probeWidth(path.join(folder, background));
  } catch {
    error(`Background "${background}" can't be read as an image.`);
    return;
  }
  if (width < VIDEO_FRAME.width) {
    warn(`Background "${background}" is ${width} px wide; below ${VIDEO_FRAME.width} px the video may look soft.`);
  }
}

type YamlRead = { doc: Record<string, unknown> } | { problem: string };

async function readEpisodeYaml(folder: string): Promise<YamlRead> {
  let raw: string;
  try {
    raw = await readFile(path.join(folder, EPISODE_FILE), "utf8");
  } catch {
    return { problem: `No ${EPISODE_FILE} in ${folder}. Run /episode on the folder to propose one.` };
  }
  let doc: unknown;
  try {
    doc = parse(raw) ?? {};
  } catch (error) {
    return { problem: `${EPISODE_FILE} is not valid YAML: ${(error as Error).message}` };
  }
  if (!isMapping(doc)) return { problem: `${EPISODE_FILE} must be a mapping with \`approved:\` and \`tracks:\` at the top level.` };
  return { doc };
}

const TRACK_FIELDS = ["file", "title", "artist"] as const;

/** Reads one Tracklist entry leniently, noting which fields are absent or blank. */
function readTracklistEntry(raw: unknown): { entry: TracklistEntry; missing: string[] } {
  const fields = isMapping(raw) ? raw : {};
  const entry: TracklistEntry = { file: "", title: "", artist: "" };
  const missing: string[] = [];
  for (const field of TRACK_FIELDS) {
    const value = fields[field];
    // A title like 1999 arrives from YAML as a number; it is still a valid name.
    const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
    if (text.trim() === "") missing.push(field);
    entry[field] = text;
  }
  return { entry, missing };
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listInWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
