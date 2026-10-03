import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, ffmpegLog, probeSampleCount, writeConcatList } from "./ffmpeg.js";

export const SAMPLE_RATE = 48_000;
const PCM = ["-ar", String(SAMPLE_RATE), "-ac", "2", "-c:a", "pcm_s16le"];

/** House loudness: every Track is levelled to this before Tracks are joined. */
const TARGET_LUFS = -14;
const TRUE_PEAK_LIMIT_DBTP = -1;
/** loudnorm's loudness-range target, used only when a Track's peaks have to be limited. */
const TARGET_LRA = 11;
/** EBU R128's absolute gate: a Track measuring this low is silence and has no level to correct. */
const SILENCE_LUFS = -70;

/**
 * Decodes one Track to PCM. Every later step (durations, the Timeline, joining) works on
 * these exact samples, so what we measure is exactly what plays. With `normalizeLoudness`,
 * the Track is levelled to the house loudness first; its length is unchanged to the sample.
 */
export async function decodeTrack(mp3: string, wavOut: string, { normalizeLoudness }: { normalizeLoudness: boolean }): Promise<void> {
  const decoded = normalizeLoudness ? `${wavOut}.decoded.wav` : wavOut;
  await ffmpeg(["-i", mp3, "-vn", "-map_metadata", "-1", ...PCM, decoded]);
  if (!normalizeLoudness) return;
  try {
    await levelLoudness(decoded, wavOut);
  } finally {
    await rm(decoded, { force: true });
  }
}

/**
 * Levels one decoded Track to TARGET_LUFS without letting its true peak pass
 * TRUE_PEAK_LIMIT_DBTP. Measure first, then:
 * - if one constant gain reaches the target with the peaks still under the limit (most
 *   Tracks), apply exactly that gain — what loudnorm's linear mode does, without its
 *   192 kHz round trip;
 * - otherwise (a quiet Track with sharp peaks) run ffmpeg's loudnorm two-pass, whose dynamic
 *   mode limits the peaks.
 * Silence is left as it is.
 */
async function levelLoudness(wavIn: string, wavOut: string): Promise<void> {
  const measured = await measureLoudness(wavIn);
  if (measured.integrated <= SILENCE_LUFS) {
    await rename(wavIn, wavOut);
    return;
  }
  const gainDb = TARGET_LUFS - measured.integrated;
  if (measured.truePeak + gainDb <= TRUE_PEAK_LIMIT_DBTP) {
    await ffmpeg(["-i", wavIn, "-af", `volume=${gainDb.toFixed(2)}dB`, ...PCM, wavOut]);
  } else {
    await loudnormTwoPass(wavIn, wavOut);
  }
}

/**
 * ffmpeg's loudnorm, two-pass: the first pass measures and predicts how far its dynamic mode
 * will miss the target (target_offset); the second applies with those figures.
 */
async function loudnormTwoPass(wavIn: string, wavOut: string): Promise<void> {
  const target = `I=${TARGET_LUFS}:TP=${TRUE_PEAK_LIMIT_DBTP}:LRA=${TARGET_LRA}`;
  const log = await ffmpegLog(["-i", wavIn, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const json = log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1);
  let firstPass: Record<string, string>;
  try {
    firstPass = JSON.parse(json) as Record<string, string>;
  } catch {
    throw new Error(`Could not read loudnorm's measurements of ${wavIn}:\n${json}`);
  }
  const measured = [
    `measured_I=${firstPass.input_i}`,
    `measured_TP=${firstPass.input_tp}`,
    `measured_LRA=${firstPass.input_lra}`,
    `measured_thresh=${firstPass.input_thresh}`,
    `offset=${firstPass.target_offset}`,
  ].join(":");
  // loudnorm works at 192 kHz; resample back to the pipeline rate, then pin the length to the
  // decoded Track's exact sample count so levelling can never move a Track Start.
  const samples = await probeSampleCount(wavIn);
  const filter = `loudnorm=${target}:${measured}:linear=false,aresample=${SAMPLE_RATE},apad=whole_len=${samples},atrim=end_sample=${samples}`;
  await ffmpeg(["-i", wavIn, "-af", filter, ...PCM, wavOut]);
}

interface MeasuredLoudness {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
}

/** EBU R128 integrated loudness and true peak, from ffmpeg's ebur128 meter. */
async function measureLoudness(wav: string): Promise<MeasuredLoudness> {
  const log = await ffmpegLog(["-i", wav, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const readDecibels = (pattern: RegExp): number => {
    const value = pattern.exec(summary)?.[1];
    if (value === "-inf") return -Infinity;
    const number = Number(value);
    if (value === undefined || Number.isNaN(number)) throw new Error(`Could not read the loudness of ${wav}:\n${summary}`);
    return number;
  };
  return { integrated: readDecibels(/I:\s+(\S+) LUFS/), truePeak: readDecibels(/Peak:\s+(\S+) dBFS/) };
}

/**
 * Lays the decoded Tracks end to end with a Gap of silence before every Track but the
 * first. Returns a concat list for ffmpeg, so the joined audio is never written out in full.
 */
export async function joinWithGaps(trackWavs: string[], gapSeconds: number, workDir: string): Promise<string> {
  const gapWav = path.join(workDir, "gap.wav");
  await ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`, "-t", String(gapSeconds), ...PCM, gapWav]);
  const list = path.join(workDir, "audio.txt");
  await writeConcatList(list, trackWavs.flatMap((wav, i) => (i === 0 ? [wav] : [gapWav, wav])));
  return list;
}
