/**
 * The one Tracklist template (ADR 0002). Render screenshots it into a transparent PNG per
 * Now-Playing Marker position; Preview will serve the very same page. Anything that changes
 * how the Tracklist looks belongs here, so the two can never drift apart.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Frame {
  width: number;
  height: number;
}

/** The video frame. The template lays out for any frame size; renders target 4K. */
export const VIDEO_FRAME: Frame = { width: 3840, height: 2160 };

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
export const FONT_FILES = { inter: "Inter-Regular.ttf", notoSansJp: "NotoSansJP-Regular.otf" } as const;

/**
 * House style, as fractions of the frame so it looks the same at any resolution.
 * Calibrated against the reference Episode (jp-city-pop, 6144×3456) by rendering and
 * comparing row widths and spacing: rows sit 1/24 of the frame height apart (≈ 47 px on a
 * 1125 px frame), the font size is half that (72 px at 3456; row widths match to < 1 %),
 * and the text's left edge is at 63.6 % of the frame width.
 */
export const HOUSE_STYLE = {
  rowPitch: 1 / 24,
  fontSize: 1 / 48,
  listLeft: 0.636,
  textColor: "#FFFFFF",
  marker: "▶",
  /** Space between the ▶ and its row's text, as a fraction of frame height. */
  markerGap: 0.0165,
  /** The ▶ is drawn smaller than the text, like the reference. */
  markerScale: 0.62,
} as const;

export interface TracklistPageOptions {
  /** Display Names in play order. */
  rows: string[];
  /** Index of the row with the Now-Playing Marker. */
  markedRow: number;
  frame: Frame;
  /** Where the page loads the bundled fonts from (a file:// URL for render, an HTTP path for Preview). */
  fontBaseUrl: string;
}

/**
 * A complete HTML page drawing the Tracklist on a transparent background. The page exposes
 * `window.setMarkedRow(index)` so one loaded page can be stepped through every
 * Now-Playing Marker position without reloading fonts.
 */
export function tracklistPage({ rows, markedRow, frame, fontBaseUrl }: TracklistPageOptions): string {
  const px = (fraction: number) => `${(fraction * frame.height).toFixed(3)}px`;
  const base = fontBaseUrl.endsWith("/") ? fontBaseUrl : `${fontBaseUrl}/`;
  const items = rows
    .map((row, i) => `<li${i === markedRow ? ' class="now-playing"' : ""}>${escapeHtml(row)}</li>`)
    .join("\n      ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Inter";
        src: url("${base}${FONT_FILES.inter}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: "Noto Sans JP";
        src: url("${base}${FONT_FILES.notoSansJp}") format("opentype");
        font-weight: 400;
        font-style: normal;
      }
      html, body {
        margin: 0;
        width: ${frame.width}px;
        height: ${frame.height}px;
        overflow: hidden;
        background: transparent;
      }
      .tracklist {
        position: absolute;
        top: 0;
        bottom: 0;
        left: ${(HOUSE_STYLE.listLeft * 100).toFixed(3)}%;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
        font-family: "Inter", "Noto Sans JP";
        font-weight: 400;
        font-size: ${px(HOUSE_STYLE.fontSize)};
        line-height: ${px(HOUSE_STYLE.rowPitch)};
        color: ${HOUSE_STYLE.textColor};
        white-space: nowrap;
      }
      .tracklist li {
        position: relative;
      }
      .tracklist li.now-playing::before {
        content: "${HOUSE_STYLE.marker}";
        position: absolute;
        right: 100%;
        margin-right: ${px(HOUSE_STYLE.markerGap)};
        font-size: ${HOUSE_STYLE.markerScale}em;
      }
    </style>
  </head>
  <body>
    <ol class="tracklist">
      ${items}
    </ol>
    <script>
      window.setMarkedRow = (index) => {
        document.querySelectorAll(".tracklist li").forEach((li, i) => li.classList.toggle("now-playing", i === index));
      };
    </script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
