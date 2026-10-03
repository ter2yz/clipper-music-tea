import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runCli, type CliResult } from "./support/cli.js";
import { findTextRows, frameAt, markedRowIndex, probeVideo } from "./support/media.js";
import { makeEpisodeFolder, writeEpisodeYaml, type FixtureTrack } from "./support/episodeFolder.js";

describe("pnpm render refuses an Episode whose Tracklist is not approved", () => {
  it("exits non-zero with a clear message and renders nothing", async () => {
    const folder = await makeEpisodeFolder({
      approved: false,
      tracks: [{ file: "a.mp3", seconds: 1, title: "First", artist: "Someone" }],
    });

    const result = await runCli("render", folder);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("episode.yaml is not approved");
    expect(result.stderr).toContain("approved: true");
    expect(existsSync(path.join(folder, "out", "video.mp4"))).toBe(false);
  });
});

describe("pnpm render on an approved Episode", () => {
  // Fractional lengths keep every Track Start away from a whole second, so the
  // expected Timestamps can't be hit by rounding luck.
  const tracks = [
    { file: "one.mp3", seconds: 2.5, signal: "noise", title: "LADY PINK PANTHER", artist: "鈴木茂" },
    { file: "two.mp3", seconds: 3.25, signal: "noise", title: "異端なスター", artist: "Official髭男dism", tags: { artist: "James" } },
    { file: "three.mp3", seconds: 2, signal: "noise", title: "SUMMER BLUE", artist: "ブレッド & バター" },
  ] satisfies FixtureTrack[];
  let folder: string;
  let result: CliResult;

  beforeAll(async () => {
    folder = await makeEpisodeFolder({ tracks });
    result = await runCli("render", folder);
  });

  it("succeeds and prints where the video went", () => {
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(path.join(folder, "out", "video.mp4"));
  });

  it("writes a 3840×2160 H.264 + AAC 320 kbps video as long as the Tracks plus one Gap between each", async () => {
    const video = await probeVideo(path.join(folder, "out", "video.mp4"));

    expect(video.video).toEqual({ codec: "h264", width: 3840, height: 2160, pixelFormat: "yuv420p" });
    expect(video.audio.codec).toBe("aac");
    // The AAC encoder targets 320 kbps on dense audio; the two silent Gaps pull the average down a little.
    expect(video.audio.bitRate).toBeGreaterThan(240_000);
    // 2.5 + 3.25 + 2 seconds of Tracks, plus 2 one-second Gaps.
    expect(video.durationSeconds).toBeCloseTo(9.75, 1);
  });

  it("writes Timestamps at each Track Start: the first at 00:00, the rest where their Gap begins", async () => {
    const timestamps = await readFile(path.join(folder, "out", "timestamps.txt"), "utf8");

    // A Track Start is where that Track's Gap begins: 0, then 2.5 (end of Track 1),
    // then 2.5 + 1 (Gap) + 3.25 = 6.75 (end of Track 2).
    expect(timestamps).toBe(
      ["00:00 LADY PINK PANTHER - 鈴木茂", "00:02 異端なスター - Official髭男dism", "00:06 SUMMER BLUE - ブレッド & バター", ""].join("\n"),
    );
  });

  it.each([
    { seconds: 0.5, row: 0, when: "during the first Track" },
    { seconds: 2.3, row: 0, when: "just before Track 2's Track Start (2.5 s)" },
    { seconds: 2.7, row: 1, when: "just after Track 2's Track Start, during its Gap" },
    { seconds: 6.55, row: 1, when: "just before Track 3's Track Start (6.75 s)" },
    { seconds: 6.95, row: 2, when: "just after Track 3's Track Start" },
    { seconds: 9.6, row: 2, when: "at the very end" },
  ])("shows the ▶ beside row $row $when", async ({ seconds, row }) => {
    const frame = await frameAt(path.join(folder, "out", "video.mp4"), seconds);
    const rows = findTextRows(frame);

    expect(rows).toHaveLength(tracks.length);
    expect(markedRowIndex(rows)).toBe(row);
  });
});

describe("re-rendering an Episode", () => {
  it("overwrites video.mp4 and timestamps.txt but leaves an existing description.md untouched", async () => {
    const tracks: FixtureTrack[] = [
      { file: "a.mp3", seconds: 1.5, title: "First", artist: "Someone" },
      { file: "b.mp3", seconds: 1.5, title: "Second", artist: "Someone" },
    ];
    const folder = await makeEpisodeFolder({ tracks });
    expect((await runCli("render", folder)).exitCode).toBe(0);
    const firstVideo = await readFile(path.join(folder, "out", "video.mp4"));
    const description = "# My title\n\nHand-edited description.\n";
    await writeFile(path.join(folder, "out", "description.md"), description);

    // Reorder and rename, then render again.
    await writeEpisodeYaml(folder, {
      approved: true,
      tracks: [
        { file: "b.mp3", title: "Second (renamed)", artist: "Someone" },
        { file: "a.mp3", title: "First", artist: "Someone" },
      ],
    });
    const second = await runCli("render", folder);

    expect(second.exitCode).toBe(0);
    expect(await readFile(path.join(folder, "out", "timestamps.txt"), "utf8")).toBe(
      "00:00 Second (renamed) - Someone\n00:01 First - Someone\n",
    );
    expect((await readFile(path.join(folder, "out", "video.mp4"))).equals(firstVideo)).toBe(false);
    expect(await readFile(path.join(folder, "out", "description.md"), "utf8")).toBe(description);
    expect((await readdir(path.join(folder, "out"))).sort()).toEqual(["description.md", "timestamps.txt", "video.mp4"]);
  });
});

describe("an Episode longer than an hour", () => {
  it("switches Timestamps to H:MM:SS once past the hour", async () => {
    // A long silent Track is cheap to generate and to render: the video is built from a
    // few short clips repeated by stream copy, so this exercises the real path end to end.
    const tracks: FixtureTrack[] = [
      { file: "long.mp3", seconds: 3599.5, signal: "silence", title: "Long Intro", artist: "Someone" },
      { file: "mid.mp3", seconds: 2.25, title: "Middle", artist: "Someone" },
      { file: "end.mp3", seconds: 1, title: "Ending", artist: "Someone" },
    ];
    const folder = await makeEpisodeFolder({ tracks });

    const result = await runCli("render", folder);

    expect(result.exitCode).toBe(0);
    // Track Starts: 0, 3599.5, 3599.5 + 1 + 2.25 = 3602.75.
    expect(await readFile(path.join(folder, "out", "timestamps.txt"), "utf8")).toBe(
      ["00:00 Long Intro - Someone", "59:59 Middle - Someone", "1:00:02 Ending - Someone", ""].join("\n"),
    );
    const video = await probeVideo(path.join(folder, "out", "video.mp4"));
    expect(video.durationSeconds).toBeCloseTo(3599.5 + 2.25 + 1 + 2, 1);
  });
});
