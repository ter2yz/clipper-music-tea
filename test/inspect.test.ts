import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";
import { addImage, addMp3, makeEpisodeFolder } from "./support/episodeFolder.js";

interface Inspection {
  folder: string;
  hasEpisodeYaml: boolean;
  backgroundCandidates: string[];
  tracks: Array<{ file: string; durationSeconds: number; tags: Record<string, string> }>;
}

async function inspect(folder: string): Promise<Inspection> {
  const result = await runCli("inspect", folder);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as Inspection;
}

describe("pnpm inspect prints the facts /episode needs about an Episode Folder, as JSON", () => {
  it("lists every Track with its duration and embedded tags, in file-name order", async () => {
    const folder = await makeEpisodeFolder({
      tracks: [
        { file: "b - second.mp3", seconds: 2, title: "B", artist: "Someone", tags: { title: "Second (Romanised)", artist: "Wrong Artist" } },
        { file: "a - first.mp3", seconds: 3, title: "A", artist: "Someone" },
      ],
    });

    const inspection = await inspect(folder);

    expect(inspection.folder).toBe(folder);
    expect(inspection.tracks.map((t) => t.file)).toEqual(["a - first.mp3", "b - second.mp3"]);
    const [first, second] = inspection.tracks;
    expect(first!.durationSeconds).toBeCloseTo(3, 0);
    expect(second!.durationSeconds).toBeCloseTo(2, 0);
    expect(second!.tags).toMatchObject({ title: "Second (Romanised)", artist: "Wrong Artist" });
    expect(first!.tags.title).toBeUndefined();
  });

  it("says whether episode.yaml exists and which Background candidates there are", async () => {
    const folder = await makeEpisodeFolder({ tracks: [{ file: "a.mp3", seconds: 1, title: "A", artist: "Someone" }] });
    await addImage(folder, "second.jpg");

    const inspection = await inspect(folder);

    expect(inspection.hasEpisodeYaml).toBe(true);
    expect(inspection.backgroundCandidates).toEqual(["background.png", "second.jpg"]);
  });

  it("reports a fresh Episode Folder as having no episode.yaml", async () => {
    const folder = await makeEpisodeFolder({ tracks: [{ file: "a.mp3", seconds: 1, title: "A", artist: "Someone" }] });
    await rm(path.join(folder, "episode.yaml"));

    const inspection = await inspect(folder);

    expect(inspection.hasEpisodeYaml).toBe(false);
    expect(inspection.tracks.map((t) => t.file)).toEqual(["a.mp3"]);
  });

  it("ignores MP3s and images inside out/", async () => {
    const folder = await makeEpisodeFolder({ tracks: [{ file: "a.mp3", seconds: 1, title: "A", artist: "Someone" }] });
    await addMp3(folder, "out/old.mp3");
    await addImage(folder, "out/frame.png");

    const inspection = await inspect(folder);

    expect(inspection.tracks.map((t) => t.file)).toEqual(["a.mp3"]);
    expect(inspection.backgroundCandidates).toEqual(["background.png"]);
  });

  it("refuses a folder that doesn't exist", async () => {
    const result = await runCli("inspect", "/no/such/episode-folder");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No Episode Folder at /no/such/episode-folder.");
  });
});
