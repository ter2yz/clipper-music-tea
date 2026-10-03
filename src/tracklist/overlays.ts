import path from "node:path";
import { fontsLoaded, withTracklistPage, type TracklistWindow } from "./browser.js";
import type { Frame, TracklistSettings } from "./template.js";

/**
 * Screenshots the Tracklist template once per Now-Playing Marker position, into
 * transparent PNGs the size of the frame. Returns the PNG paths in Tracklist order.
 */
export async function renderTracklistOverlays(rows: string[], settings: TracklistSettings, frame: Frame, workDir: string): Promise<string[]> {
  return withTracklistPage(rows, settings, frame, async (page) => {
    const overlays: string[] = [];
    for (let row = 0; row < rows.length; row++) {
      await page.evaluate((index) => (window as unknown as TracklistWindow).setMarkedRow(index), row);
      await fontsLoaded(page);
      const file = path.join(workDir, `overlay-${String(row + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      overlays.push(file);
    }
    return overlays;
  });
}
