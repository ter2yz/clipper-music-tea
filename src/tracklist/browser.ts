import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { FONTS_DIR, tracklistPage, type Frame, type TracklistSettings } from "./template.js";

/** What the template page exposes on `window` (see tracklistPage). */
export interface TracklistWindow {
  setMarkedRow(index: number): void;
  /** Puts the ▶ on every row at once; it is absolutely positioned, so nothing else moves. */
  markAllRows(): void;
  /**
   * Each row's extent from its ▶'s left edge to the end of its text, laid out as if it were the
   * widest row (see tracklistPage). Call after markAllRows.
   */
  rowExtents(): { left: number; right: number }[];
}

/**
 * Loads the shared Tracklist template in headless Chromium at the frame's size, with the
 * bundled fonts loaded, and hands the page to `use`. Render and the width check both go
 * through here with the Episode's settings, so they lay text out identically. With `browser`,
 * the page opens in that already-running browser (Preview keeps one open so each check is
 * quick); otherwise a browser is launched for this page alone.
 */
export async function withTracklistPage<T>(rows: string[], settings: TracklistSettings, frame: Frame, browser: Browser | undefined, use: (page: Page) => Promise<T>): Promise<T> {
  const pageDir = await mkdtemp(path.join(tmpdir(), "clipper-tracklist-"));
  let launched: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    const pageFile = path.join(pageDir, "tracklist.html");
    await writeFile(pageFile, tracklistPage({ rows, markedRow: 0, settings, frame, fontBaseUrl: pathToFileURL(FONTS_DIR).href }));
    if (!browser) browser = launched = await chromium.launch();
    context = await browser.newContext({ viewport: frame, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(pathToFileURL(pageFile).href);
    await fontsLoaded(page);
    return await use(page);
  } finally {
    await context?.close();
    await launched?.close();
    await rm(pageDir, { recursive: true, force: true });
  }
}

/** Waits for every font the page currently uses — the ▶ may pull in one not used before. */
export async function fontsLoaded(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
