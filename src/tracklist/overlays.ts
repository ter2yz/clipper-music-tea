import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { FONTS_DIR, tracklistPage, type Frame } from "./template.js";

/**
 * Screenshots the Tracklist template once per Now-Playing Marker position, into
 * transparent PNGs the size of the frame. Returns the PNG paths in Tracklist order.
 */
export async function renderTracklistOverlays(rows: string[], frame: Frame, workDir: string): Promise<string[]> {
  const pageFile = path.join(workDir, "tracklist.html");
  await writeFile(pageFile, tracklistPage({ rows, markedRow: 0, frame, fontBaseUrl: pathToFileURL(FONTS_DIR).href }));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: frame, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(pageFile).href);
    await page.evaluate(() => document.fonts.ready);

    const overlays: string[] = [];
    for (let row = 0; row < rows.length; row++) {
      await page.evaluate((index) => (window as unknown as { setMarkedRow(i: number): void }).setMarkedRow(index), row);
      // The ▶ may pull in a font not yet used on the page; wait for it before capturing.
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(workDir, `overlay-${String(row + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      overlays.push(file);
    }
    return overlays;
  } finally {
    await browser.close();
  }
}
