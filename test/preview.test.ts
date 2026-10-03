import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "playwright";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { makeEpisodeFolder, writeEpisodeYaml } from "./support/episodeFolder.js";
import { closeBrowser, openPage, startPreview, stopAllPreviews } from "./support/preview.js";

const exec = promisify(execFile);

afterEach(stopAllPreviews);
afterAll(closeBrowser);

const track = (file: string, title: string, artist = "Someone") => ({ file, seconds: 1, title, artist });

/** The Display Names drawn in the Preview's Tracklist, top to bottom. */
function rows(page: Page): Promise<string[]> {
  return page.frameLocator("#tracklist").locator("li").allTextContents();
}

/** Index of the row wearing the ▶, or -1. */
async function markedRow(page: Page): Promise<number> {
  const classes = await page.frameLocator("#tracklist").locator("li").evaluateAll((lis) => lis.map((li) => li.className));
  return classes.findIndex((c) => c.split(" ").includes("now-playing"));
}

function problems(page: Page): Promise<string[]> {
  return page.locator("#problems li").allTextContents();
}

describe("pnpm preview", () => {
  it("serves the 16:9 frame of an unapproved Episode: Background cropped like the render, Tracklist from episode.yaml", async () => {
    const folder = await makeEpisodeFolder({
      approved: false,
      tracks: [track("a.mp3", "Plastic Love", "竹内まりや"), track("b.mp3", "異端なスター", "Official髭男dism")],
      background: null,
    });
    // A wide Background whose outer 600 px on each side are red. Covering a 16:9 frame crops
    // 667 px off each side, so a correct crop shows no red at all; stretching or letterboxing would.
    await exec("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi",
      "-i", "color=c=0x18222e:s=4000x1500,drawbox=x=0:y=0:w=600:h=1500:color=red:t=fill,drawbox=x=3400:y=0:w=600:h=1500:color=red:t=fill",
      "-frames:v", "1", path.join(folder, "background.png"),
    ]);

    const preview = await startPreview(folder);
    const page = await openPage(preview.url);

    expect(await rows(page)).toEqual(["Plastic Love - 竹内まりや", "異端なスター - Official髭男dism"]);
    expect(await markedRow(page)).toBe(0);
    expect((await problems(page)).join("\n")).not.toMatch(/approved/);

    const box = (await page.locator("#frame").boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
    // Fits the window: neither side spills out.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + box.height).toBeLessThanOrEqual(900);

    const pixels = await screenshotRgb(page);
    let red = 0;
    let background = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
      if (r > 150 && g < 80 && b < 80) red++;
      if (Math.abs(r - 0x18) < 8 && Math.abs(g - 0x22) < 8 && Math.abs(b - 0x2e) < 8) background++;
    }
    expect(red).toBe(0);
    // Nearly all of the frame is the Background's dark centre.
    expect(background / (pixels.length / 3)).toBeGreaterThan(0.9);
  });

  it("moves the Now-Playing Marker through every Track with ← and →", async () => {
    const folder = await makeEpisodeFolder({ approved: false, tracks: [track("a.mp3", "One"), track("b.mp3", "Two"), track("c.mp3", "Three")] });
    const preview = await startPreview(folder);
    const page = await openPage(preview.url);

    expect(await markedRow(page)).toBe(0);
    await page.keyboard.press("ArrowLeft");
    expect(await markedRow(page)).toBe(0);
    await page.keyboard.press("ArrowRight");
    expect(await markedRow(page)).toBe(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await markedRow(page)).toBe(2);
    await page.keyboard.press("ArrowLeft");
    expect(await markedRow(page)).toBe(1);
  });

  it("reloads with the new Tracklist when episode.yaml is saved, keeping the ▶ where it was", async () => {
    const folder = await makeEpisodeFolder({ approved: false, tracks: [track("a.mp3", "One"), track("b.mp3", "Two"), track("c.mp3", "Three")] });
    const preview = await startPreview(folder);
    const page = await openPage(preview.url);
    await page.keyboard.press("ArrowRight");

    // Rename Track a and move it last.
    await writeEpisodeYaml(folder, {
      approved: false,
      tracks: [
        { file: "b.mp3", title: "Two", artist: "Someone" },
        { file: "c.mp3", title: "Three", artist: "Someone" },
        { file: "a.mp3", title: "One (Renamed)", artist: "Someone" },
      ],
    });

    await expect.poll(() => rows(page), { timeout: 10_000 }).toEqual(["Two - Someone", "Three - Someone", "One (Renamed) - Someone"]);
    await expect.poll(() => markedRow(page)).toBe(1);
    // Still the same server: stepping works on the new list.
    await page.keyboard.press("ArrowRight");
    expect(await markedRow(page)).toBe(2);
  });

  it("draws the Tracklist with the Episode Settings, and warns about a small Background", async () => {
    const folder = await makeEpisodeFolder({
      approved: true,
      settings: { side: "left", textColor: "#FF0000" },
      tracks: [track("a.mp3", "One"), track("b.mp3", "Two")],
      background: { width: 1920, height: 1080 },
    });
    const preview = await startPreview(folder);
    const page = await openPage(preview.url);

    await expect(page.locator("#tracklist").isVisible()).resolves.toBe(true);
    const list = page.frameLocator("#tracklist").locator("ol");
    expect(await list.evaluate((ol) => getComputedStyle(ol).color)).toBe("rgb(255, 0, 0)");
    // In frame pixels: on the left side the whole list sits in the frame's left half.
    expect(await list.evaluate((ol) => ol.getBoundingClientRect().right)).toBeLessThan(3840 / 2);
    expect(await problems(page)).toEqual([expect.stringContaining('Background "background.png" is 1920 px wide; below 3840 px the video may look soft.')]);
  });

  it("lists a row too wide and an unsupported character as warnings, still drawing the frame", async () => {
    const long = "Midnight Pretenders (Extended Club Mix featuring Everyone We Know)";
    const folder = await makeEpisodeFolder({
      approved: false,
      tracks: [track("a.mp3", "Plastic Love", "竹内まりや"), track("b.mp3", long, "亜蘭知子"), track("c.mp3", "봄날 🌸", "BTS")],
    });
    const preview = await startPreview(folder);
    const page = await openPage(preview.url);

    const listed = await problems(page);
    expect(listed).toHaveLength(2);
    expect(listed).toContainEqual(expect.stringMatching(new RegExp(`Track 2 "${long.replace(/[()]/g, "\\$&")} - 亜蘭知子" is too wide for the frame: with the ▶ it runs \\d+ px past the safe area`)));
    expect(listed).toContainEqual(expect.stringContaining('Track 3 "봄날 🌸 - BTS" has characters neither Inter nor Noto Sans JP can draw: "봄" (U+BD04), "날" (U+B0A0), "🌸" (U+1F338).'));
    expect(await page.locator("h2").textContent()).toBe("Warnings (2)");
    expect(await rows(page)).toHaveLength(3);
  });

  it("shows malformed YAML as a problem, keeps serving, and recovers on the next save", async () => {
    const folder = await makeEpisodeFolder({ approved: false, tracks: [track("a.mp3", "One")] });
    const preview = await startPreview(folder);
    const page = await openPage(preview.url);

    await writeFile(path.join(folder, "episode.yaml"), "approved: false\ntracks:\n  - file: a.mp3\n    title: [unclosed\n");
    await expect.poll(() => problems(page), { timeout: 10_000 }).toEqual([expect.stringContaining("episode.yaml is not valid YAML")]);
    expect(await page.locator("#tracklist").count()).toBe(0);

    await writeEpisodeYaml(folder, { approved: true, tracks: [{ file: "a.mp3", title: "One, fixed", artist: "Someone" }] });
    await expect.poll(() => rows(page), { timeout: 10_000 }).toEqual(["One, fixed - Someone"]);
    expect(await problems(page)).toEqual([]);
    expect(await page.locator(".status").textContent()).toBe("Approved");
  });
});

/** The frame as the user sees it, decoded to RGB bytes. */
async function screenshotRgb(page: Page): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "clipper-preview-shot-"));
  const file = path.join(dir, "frame.png");
  await writeFile(file, await page.locator("#frame").screenshot());
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
