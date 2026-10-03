import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { FONTS_DIR, tracklistPage, type Frame } from "./template.js";

/** What the template page exposes on `window` (see tracklistPage). */
export interface TracklistWindow {
  setMarkedRow(index: number): void;
  /** Puts the ▶ on every row at once; it is absolutely positioned, so nothing else moves. */
  markAllRows(): void;
  /** Each row's extent from its ▶'s left edge to the end of its text. Call after markAllRows. */
  rowExtents(): { left: number; right: number }[];
}

/**
 * Loads the shared Tracklist template in headless Chromium at the frame's size, with the
 * bundled fonts loaded, and hands the page to `use`. Render and the width check both go
 * through here, so they lay text out identically.
 */
export async function withTracklistPage<T>(rows: string[], frame: Frame, use: (page: Page) => Promise<T>): Promise<T> {
  const pageDir = await mkdtemp(path.join(tmpdir(), "clipper-tracklist-"));
  let browser: Browser | undefined;
  try {
    const pageFile = path.join(pageDir, "tracklist.html");
    await writeFile(pageFile, tracklistPage({ rows, markedRow: 0, frame, fontBaseUrl: pathToFileURL(FONTS_DIR).href }));
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: frame, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(pageFile).href);
    await fontsLoaded(page);
    return await use(page);
  } finally {
    await browser?.close();
    await rm(pageDir, { recursive: true, force: true });
  }
}

/** Waits for every font the page currently uses — the ▶ may pull in one not used before. */
export async function fontsLoaded(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
