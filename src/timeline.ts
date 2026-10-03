/** Length of the silence before every Track except the first. It belongs to the Track after it. */
export const GAP_SECONDS = 1;

export interface Timeline {
  /** Track Start of each Track, in play order: where its Gap begins (0 for the first Track). */
  trackStarts: number[];
  totalSeconds: number;
}

/**
 * Track n's segment is its Gap (none for the first Track) followed by the Track itself, and its
 * Track Start is where that segment — i.e. the Gap — begins (CONTEXT.md). So Track Start(1) = 0
 * and Track Start(n) is the moment Track n−1 finishes playing. No Gap after the last Track.
 */
export function planTimeline(trackDurations: number[]): Timeline {
  const trackStarts: number[] = [];
  let elapsed = 0;
  trackDurations.forEach((duration, index) => {
    const gap = index === 0 ? 0 : GAP_SECONDS;
    trackStarts.push(elapsed);
    elapsed += gap + duration;
  });
  return { trackStarts, totalSeconds: elapsed };
}

/** `MM:SS`, or `H:MM:SS` from one hour on. Rounds down, so a chapter link never lands after its Track Start. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds + 1e-6);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** One `<timestamp> <Display Name>` line per Track, ready to paste into a YouTube description. */
export function timestampsText(displayNames: string[], timeline: Timeline): string {
  return displayNames.map((name, i) => `${formatTimestamp(timeline.trackStarts[i]!)} ${name}`).join("\n") + "\n";
}
