import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";
import { addImage, addMp3, makeEpisodeFolder, writeEpisodeYaml } from "./support/episodeFolder.js";

const track = (file: string) => ({ file, seconds: 1, title: `Title of ${file}`, artist: "Someone" });

async function expectRefusal(folder: string, messages: string[]): Promise<void> {
  const result = await runCli("render", folder);
  expect(result.exitCode).not.toBe(0);
  for (const message of messages) expect(result.stderr).toContain(`Error: ${message}\n`);
  expect(result.stderr).toContain("Render refused.");
  expect(existsSync(path.join(folder, "out", "video.mp4"))).toBe(false);
}

describe("pnpm render refuses an Episode Folder that doesn't match episode.yaml", () => {
  it("names a Track listed in episode.yaml that isn't in the folder", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await writeEpisodeYaml(folder, {
      approved: true,
      tracks: [
        { file: "a.mp3", title: "A", artist: "Someone" },
        { file: "b.mp3", title: "B", artist: "Someone" },
      ],
    });

    await expectRefusal(folder, ['Track 2 "b.mp3" is listed in episode.yaml but there is no such MP3 in the Episode Folder.']);
  });

  it("names a Track listed more than once, and where", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3"), track("b.mp3")] });
    await writeEpisodeYaml(folder, {
      approved: true,
      tracks: [
        { file: "a.mp3", title: "A", artist: "Someone" },
        { file: "b.mp3", title: "B", artist: "Someone" },
        { file: "a.mp3", title: "A again", artist: "Someone" },
      ],
    });

    await expectRefusal(folder, ['"a.mp3" is listed more than once in episode.yaml (Tracks 1 and 3). List each Track once.']);
  });

  it("names an MP3 in the folder that episode.yaml doesn't list", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await addMp3(folder, "extra.mp3");

    await expectRefusal(folder, ['"extra.mp3" is in the Episode Folder but not listed in episode.yaml. List it under `tracks:` or move it out of the folder.']);
  });
});

describe("pnpm render refuses an Episode Folder without exactly one Background", () => {
  it("says so when there is no image", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")], background: null });

    await expectRefusal(folder, ["No Background image in the Episode Folder. Add one .jpg, .jpeg, .png or .webp image."]);
  });

  it("names the images when there is more than one", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")], background: { file: "background.png", width: 3840, height: 2160 } });
    await addImage(folder, "extra.JPG");

    await expectRefusal(folder, ["Found 2 Background images in the Episode Folder (background.png, extra.JPG). Keep exactly one."]);
  });
});

describe("pnpm render refuses an episode.yaml that breaks the schema", () => {
  it("requires at least one Track", async () => {
    const folder = await makeEpisodeFolder({ tracks: [] });
    await writeEpisodeYaml(folder, { approved: true, tracks: [] });

    await expectRefusal(folder, ["episode.yaml: `tracks` must list at least one Track."]);
  });

  it("allows at most 20 Tracks", async () => {
    const tracks = Array.from({ length: 21 }, (_, i) => track(`track-${String(i + 1).padStart(2, "0")}.mp3`));
    const folder = await makeEpisodeFolder({ tracks });

    await expectRefusal(folder, ["episode.yaml lists 21 Tracks; an Episode can have at most 20."]);
  });

  it("requires every Track to have a file, title and artist", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3"), track("b.mp3")] });
    await writeEpisodeYaml(folder, {
      approved: true,
      tracks: [
        { file: "a.mp3", artist: "Someone" },
        { file: "b.mp3", title: "", artist: "Someone" },
        { title: "Third" },
      ],
    });

    await expectRefusal(folder, [
      "episode.yaml: Track 1 is missing `title`.",
      "episode.yaml: Track 2 is missing `title`.",
      "episode.yaml: Track 3 is missing `file` and `artist`.",
    ]);
  });

  it.each([
    { case: "missing", approved: undefined },
    { case: "not a boolean", approved: "yes" },
  ])("requires `approved` to be true or false ($case)", async ({ approved }) => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await writeEpisodeYaml(folder, { approved, tracks: [{ file: "a.mp3", title: "A", artist: "Someone" }] });

    await expectRefusal(folder, ["episode.yaml: `approved` is required and must be true or false."]);
  });

  it("refuses an Episode that isn't approved yet", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")], approved: false });

    await expectRefusal(folder, ["episode.yaml is not approved. Review the Tracklist, then set `approved: true` to render."]);
  });

  it.each([
    { setting: { side: "middle" }, message: 'episode.yaml: `side` must be "right" or "left", not "middle".' },
    { setting: { textColor: "blurple" }, message: 'episode.yaml: `textColor` must be a CSS colour such as "#FFFFFF", not "blurple".' },
    { setting: { textColor: "#12345" }, message: 'episode.yaml: `textColor` must be a CSS colour such as "#FFFFFF", not "#12345".' },
    { setting: { textColor: "rgb(banana)" }, message: 'episode.yaml: `textColor` must be a CSS colour such as "#FFFFFF", not "rgb(banana)".' },
    { setting: { normalizeLoudness: "yes" }, message: 'episode.yaml: `normalizeLoudness` must be true or false, not "yes".' },
  ])("refuses Episode Settings $setting", async ({ setting, message }) => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await writeEpisodeYaml(folder, { approved: true, ...setting, tracks: [{ file: "a.mp3", title: "A", artist: "Someone" }] });

    await expectRefusal(folder, [message]);
  });

  it.each([
    { case: "not valid YAML", yaml: "approved: true\ntracks: [\n", message: "episode.yaml is not valid YAML: " },
    { case: "not a mapping", yaml: "- a.mp3\n", message: "episode.yaml must be a mapping with `approved:` and `tracks:` at the top level.\n" },
  ])("refuses an episode.yaml that is $case", async ({ yaml, message }) => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await writeFile(path.join(folder, "episode.yaml"), yaml);

    const result = await runCli("render", folder);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`Error: ${message}`);
    expect(result.stderr).toContain("Render refused.");
  });
});

describe("pnpm render on a Background narrower than 3840 px", () => {
  it("warns that the video may look soft, but still renders", async () => {
    const folder = await makeEpisodeFolder({
      tracks: [track("a.mp3")],
      background: { file: "small.jpg", width: 1920, height: 1080 },
    });
    // Valid Episode Settings are accepted alongside the warning.
    await writeEpisodeYaml(folder, {
      approved: true,
      side: "right",
      textColor: "rgb(255 255 255 / 0.9)",
      normalizeLoudness: false,
      tracks: [{ file: "a.mp3", title: "A", artist: "Someone" }],
    });

    const result = await runCli("render", folder);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('Warning: Background "small.jpg" is 1920 px wide; below 3840 px the video may look soft.\n');
    expect(existsSync(path.join(folder, "out", "video.mp4"))).toBe(true);
  });
});

describe("pnpm render on a folder with several problems", () => {
  it("reports every problem in a single run", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3"), track("b.mp3")] });
    await addImage(folder, "second.webp");
    await writeEpisodeYaml(folder, {
      approved: false,
      side: "top",
      tracks: [
        { file: "a.mp3", title: "A" },
        { file: "missing.mp3", title: "M", artist: "Someone" },
      ],
    });

    await expectRefusal(folder, [
      "Found 2 Background images in the Episode Folder (background.png, second.webp). Keep exactly one.",
      "episode.yaml is not approved. Review the Tracklist, then set `approved: true` to render.",
      'episode.yaml: `side` must be "right" or "left", not "top".',
      "episode.yaml: Track 1 is missing `artist`.",
      'Track 2 "missing.mp3" is listed in episode.yaml but there is no such MP3 in the Episode Folder.',
      '"b.mp3" is in the Episode Folder but not listed in episode.yaml. List it under `tracks:` or move it out of the folder.',
    ]);
  });
});

describe("the out/ folder", () => {
  it("is never treated as input: old renders, MP3s and images inside it don't affect validation", async () => {
    const folder = await makeEpisodeFolder({ tracks: [track("a.mp3")] });
    await addMp3(folder, "out/old-track.mp3");
    await addImage(folder, "out/old-frame.png");
    await addImage(folder, "out/small.jpg", 640, 360);

    const result = await runCli("render", folder);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(folder, "out", "video.mp4"))).toBe(true);
  });
});

describe("pnpm render refuses Display Names that would not draw safely", () => {
  it("names a row with characters neither bundled font can draw, and the characters", async () => {
    const folder = await makeEpisodeFolder({
      tracks: [
        { ...track("a.mp3"), title: "Plastic Love", artist: "竹内まりや" },
        { ...track("b.mp3"), title: "봄날 🌸", artist: "BTS" },
      ],
    });

    await expectRefusal(folder, [
      'Track 2 "봄날 🌸 - BTS" has characters neither Inter nor Noto Sans JP can draw: "봄" (U+BD04), "날" (U+B0A0), "🌸" (U+1F338). Replace them or write the name another way.',
    ]);
  });

  it("lets Japanese mixed with Latin through, and renders it", async () => {
    const folder = await makeEpisodeFolder({
      tracks: [
        { ...track("a.mp3"), title: "すてきなメゾン feat. 玉城ティナ", artist: "tofubeats" },
        { ...track("b.mp3"), title: "異端なスター", artist: "Official髭男dism" },
        { ...track("c.mp3"), title: "LADY PINK PANTHER", artist: "鈴木茂" },
      ],
    });

    const result = await runCli("render", folder);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(folder, "out", "video.mp4"))).toBe(true);
  });

  it("names a row too wide for the frame's safe area", async () => {
    const long = "Midnight Pretenders (Extended Club Mix featuring Everyone We Know)";
    const folder = await makeEpisodeFolder({
      tracks: [
        { ...track("a.mp3"), title: "Plastic Love", artist: "竹内まりや" },
        { ...track("b.mp3"), title: long, artist: "亜蘭知子" },
      ],
    });

    const result = await runCli("render", folder);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      new RegExp(`^Error: Track 2 "${long.replace(/[()]/g, "\\$&")} - 亜蘭知子" is too wide for the frame: with the ▶ it runs \\d+ px past the safe area\\. Shorten its title or artist\\.$`, "m"),
    );
    expect(result.stderr).not.toContain("Track 1");
    expect(result.stderr).toContain("Render refused.");
  });

  it("checks rows against the side the Tracklist is drawn on, naming only the rows too wide", async () => {
    // Wide enough to fit on the right, but on the left — where the list is mirrored and the ▶
    // hangs off its left edge — it runs past the safe area.
    const wide = { ...track("b.mp3"), title: "Midnight Pretenders (Extended Club Version)", artist: "亜蘭知子" };
    const tracks = [{ ...track("a.mp3"), title: "Plastic Love", artist: "竹内まりや" }, wide];
    const onRight = await makeEpisodeFolder({ tracks });
    const onLeft = await makeEpisodeFolder({ tracks, settings: { side: "left" } });

    const right = await runCli("render", onRight);
    const left = await runCli("render", onLeft);

    expect(right.stderr).toBe("");
    expect(right.exitCode).toBe(0);
    expect(left.exitCode).not.toBe(0);
    expect(left.stderr).toMatch(
      /^Error: Track 2 "Midnight Pretenders \(Extended Club Version\) - 亜蘭知子" is too wide for the frame: with the ▶ it runs \d+ px past the safe area\. Shorten its title or artist\.$/m,
    );
    expect(left.stderr).not.toContain("Track 1");
  });
});
