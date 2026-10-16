import path from "node:path";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";
import { makeEpisodeFolder, type FixtureTrack } from "./support/episodeFolder.js";
import { findSilences, measureLoudness, probeVideo, type Loudness } from "./support/media.js";

// Three Tracks far from −14 LUFS in different ways: very quiet, very loud, and quiet with
// sharp peaks (raising it to −14 LUFS with plain gain would push its peaks past 0 dBTP).
const tracks = [
  { file: "quiet.mp3", seconds: 2.5, gainDb: -20, title: "Quiet", artist: "Someone" },
  { file: "loud.mp3", seconds: 3.25, gainDb: 15, title: "Loud", artist: "Someone" },
  { file: "peaky.mp3", seconds: 4, signal: "peaky", title: "Peaky", artist: "Someone" },
] satisfies FixtureTrack[];

// Where each Track's audio plays in the video: 0–2.5 s, a 1 s Gap, 3.5–6.75 s, a 1 s Gap,
// 7.75–11.75 s. Each is measured a little inside its ends, clear of the edges.
const segments = [
  { from: 0.1, to: 2.4 },
  { from: 3.6, to: 6.65 },
  { from: 7.85, to: 11.65 },
];
/** Each Gap starts where the Track before it ends. */
const gaps = [{ start: 2.5 }, { start: 6.75 }];
const EXPECTED_SECONDS = 2.5 + 1 + 3.25 + 1 + 4;
const EXPECTED_TIMESTAMPS = "00:00 Quiet - Someone\n00:02 Loud - Someone\n00:06 Peaky - Someone\n";

// The limiter holds the levelled audio to −1 dBTP; AAC encoding can overshoot that by a few
// tenths of a dB, which is still well clear of clipping.
const MAX_TRUE_PEAK_DBTP = -0.5;

interface Run {
  folder: string;
  video: string;
  /** Loudness of each Track's segment in the rendered video. */
  levels: Loudness[];
  /** Loudness of each input MP3. */
  inputs: Loudness[];
}

async function renderAndMeasure(settings: { normalizeLoudness?: boolean }): Promise<Run> {
  const folder = await makeEpisodeFolder({ tracks, settings });
  const result = await runCli("render", folder);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const video = path.join(folder, "out", "video.mp4");
  const levels = await Promise.all(segments.map(({ from, to }) => measureLoudness(video, from, to)));
  const inputs = await Promise.all(tracks.map((track) => measureLoudness(path.join(folder, track.file))));
  return { folder, video, levels, inputs };
}

async function expectGapsSilentAndTimingUnchanged(run: Run): Promise<void> {
  expect(await readFile(path.join(run.folder, "out", "timestamps.txt"), "utf8")).toBe(EXPECTED_TIMESTAMPS);
  expect((await probeVideo(run.video)).durationSeconds).toBeCloseTo(EXPECTED_SECONDS, 1);
  // The only silences are the Gaps, each starting where a Track ends and lasting 1 s (to within
  // a few ms: where a tone crosses the silence threshold isn't sample-exact).
  const silences = await findSilences(run.video, 0.5);
  expect(silences).toHaveLength(gaps.length);
  silences.forEach(([start, end], i) => {
    expect(start).toBeCloseTo(gaps[i]!.start, 2);
    expect(end).toBeCloseTo(gaps[i]!.start + 1, 2);
  });
}

describe("loudness levelling is on by default", () => {
  let run: Run;
  beforeAll(async () => {
    run = await renderAndMeasure({});
  });

  it("levels every Track's segment to about −14 LUFS, however quiet or loud it was", () => {
    // The inputs really are far apart: about −42, −7 and −23 LUFS.
    const [quiet, loud, peaky] = run.inputs.map((input) => input.integrated);
    expect(quiet).toBeLessThan(-35);
    expect(loud).toBeGreaterThan(-10);
    expect(peaky).toBeLessThan(-20);
    for (const level of run.levels) {
      expect(level.integrated).toBeGreaterThanOrEqual(-15);
      expect(level.integrated).toBeLessThanOrEqual(-13);
    }
  });

  it("limits peaks instead of clipping, even where levelling had to raise a peaky Track", () => {
    // Plain gain to −14 LUFS would put the peaky Track's peaks above 0 dBTP.
    expect(run.inputs[2]!.truePeak + (-14 - run.inputs[2]!.integrated)).toBeGreaterThan(0);
    for (const level of run.levels) expect(level.truePeak).toBeLessThanOrEqual(MAX_TRUE_PEAK_DBTP);
  });

  it("keeps the Gaps silent and exactly 1 s, so the Timestamps and length are unchanged", async () => {
    await expectGapsSilentAndTimingUnchanged(run);
  });
});

describe("normalizeLoudness: false", () => {
  let run: Run;
  beforeAll(async () => {
    run = await renderAndMeasure({ normalizeLoudness: false });
  });

  it("leaves every Track's segment at the level of its input", () => {
    run.levels.forEach((level, i) => {
      expect(Math.abs(level.integrated - run.inputs[i]!.integrated)).toBeLessThan(0.5);
    });
  });

  it("keeps the same Gaps, Timestamps and length as a levelled render", async () => {
    await expectGapsSilentAndTimingUnchanged(run);
  });
});
