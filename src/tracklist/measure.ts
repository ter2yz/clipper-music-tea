import { fontsLoaded, withTracklistPage, type TracklistWindow } from "./browser.js";
import type { Frame, HorizontalSpan } from "./template.js";

/**
 * Where each row would sit with the Now-Playing Marker beside it, in frame pixels, laid out
 * by the same page the render screenshots.
 */
export async function measureTracklistRows(rows: string[], frame: Frame): Promise<HorizontalSpan[]> {
  const extents = await withTracklistPage(rows, frame, async (page) => {
    await page.evaluate(() => (window as unknown as TracklistWindow).markAllRows());
    await fontsLoaded(page);
    return page.evaluate(() => (window as unknown as TracklistWindow).rowExtents());
  });
  extents.forEach(({ left, right }, i) => {
    // A layout the check can't read must never pass as "fits".
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error(`Could not measure Tracklist row ${i + 1} (${left} to ${right}).`);
  });
  return extents;
}
