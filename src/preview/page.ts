import { displayName, type Episode } from "../episode.js";
import { tracklistPage, VIDEO_FRAME } from "../tracklist/template.js";
import type { Problem } from "../validation.js";

export interface PreviewPageOptions {
  /** Shown in the page title and panel. */
  folderName: string;
  /** Absent when episode.yaml can't be read at all; the frame then shows the Background alone. */
  episode: Episode | undefined;
  problems: Problem[];
  /** URL of the Background, or absent when the folder doesn't have exactly one. */
  backgroundUrl: string | undefined;
  /** Where the bundled fonts are served from. */
  fontBaseUrl: string;
  /** Which check of the Episode Folder this page shows; the page reloads when the server has a newer one. */
  version: number;
}

const { width, height } = VIDEO_FRAME;

/**
 * The Preview page: the frame at the video's own size (3840×2160), scaled down to fit the
 * window, with the Background laid out exactly as the render crops it (scaled to cover the
 * frame, centred) and the Tracklist drawn by the render's own template in an iframe on top. A
 * side panel lists every Problem, all shown as warnings. ← / → move the Now-Playing Marker,
 * and the page reloads itself when the server reports a newer check (after episode.yaml or the
 * folder changes).
 */
export function previewPage({ folderName, episode, problems, backgroundUrl, fontBaseUrl, version }: PreviewPageOptions): string {
  const rows = episode?.tracklist.map(displayName) ?? [];
  const tracklist = episode
    ? `<iframe id="tracklist" title="Tracklist" srcdoc="${escapeHtml(tracklistPage({ rows, markedRow: 0, settings: { side: episode.side, textColor: episode.textColor }, frame: VIDEO_FRAME, fontBaseUrl }))}"></iframe>`
    : "";
  const status = !episode ? "episode.yaml can't be read" : episode.approved ? "Approved" : "Not approved yet";
  const problemItems = problems
    .map((p) => `<li class="${p.severity}">${p.severity === "error" ? '<span class="tag">Blocks render</span> ' : ""}${escapeHtml(p.message)}</li>`)
    .join("\n          ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview · ${escapeHtml(folderName)}</title>
    <style>
      /* No color-scheme here: an iframe whose colour scheme differs from its page's is painted opaque, hiding the Background. */
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; }
      body {
        display: flex;
        background: #111;
        color: #ddd;
        font: 14px/1.45 system-ui, -apple-system, sans-serif;
      }
      main { flex: 1; min-width: 0; position: relative; }
      #frame { position: absolute; overflow: hidden; background: #000; }
      #stage {
        position: absolute;
        left: 0;
        top: 0;
        width: ${width}px;
        height: ${height}px;
        transform-origin: 0 0;
        ${backgroundUrl ? `background: url("${escapeHtml(backgroundUrl)}") center / cover no-repeat;` : ""}
      }
      #tracklist { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; visibility: hidden; }
      aside { width: 360px; flex: none; overflow-y: auto; padding: 20px; border-left: 1px solid #2a2a2a; background: #181818; }
      h1 { font-size: 16px; margin: 0 0 4px; word-break: break-all; }
      .status { margin: 0 0 16px; color: #aaa; }
      .position { margin: 0 0 20px; }
      kbd { border: 1px solid #555; border-radius: 3px; padding: 0 4px; font: inherit; }
      h2 { font-size: 14px; margin: 0 0 8px; }
      #problems { margin: 0; padding: 0; list-style: none; }
      #problems li { margin: 0 0 8px; padding: 8px 10px; border-left: 3px solid #e0a020; background: #2a2414; border-radius: 3px; }
      .tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #e0a020; }
      .none { color: #8c8; }
      @media (max-width: 800px) {
        body { flex-direction: column; }
        main { flex: none; height: 60vh; }
        aside { width: auto; border-left: 0; border-top: 1px solid #2a2a2a; }
      }
    </style>
  </head>
  <body>
    <main>
      <div id="frame"><div id="stage">${tracklist}</div></div>
    </main>
    <aside>
      <h1>${escapeHtml(folderName)}</h1>
      <p class="status">${status}</p>
      <p class="position">${rows.length > 0 ? `▶ on Track <span id="position">1</span> of ${rows.length} · <kbd>←</kbd> <kbd>→</kbd> to move` : "No Tracklist to show"}</p>
      <h2>${problems.length === 0 ? '<span class="none">No problems found</span>' : `Warnings (${problems.length})`}</h2>
      <ul id="problems">
          ${problemItems}
      </ul>
    </aside>
    <script>
      const VERSION = ${version};
      const ROWS = ${rows.length};
      const FRAME = { width: ${width}, height: ${height} };
      const main = document.querySelector("main");
      const frame = document.getElementById("frame");
      const stage = document.getElementById("stage");
      const tracklist = document.getElementById("tracklist");

      // Scale the full-size frame to fit the window, keeping 16:9.
      function fit() {
        const scale = Math.min(main.clientWidth / FRAME.width, main.clientHeight / FRAME.height);
        const w = FRAME.width * scale;
        const h = FRAME.height * scale;
        Object.assign(frame.style, { width: w + "px", height: h + "px", left: (main.clientWidth - w) / 2 + "px", top: (main.clientHeight - h) / 2 + "px" });
        stage.style.transform = "scale(" + scale + ")";
      }
      new ResizeObserver(fit).observe(main);
      fit();

      // The marked row lives in the URL (#3 = Track 3), so it survives the reload after a save.
      let marked = Math.min(Math.max((parseInt(location.hash.slice(1), 10) || 1) - 1, 0), Math.max(ROWS - 1, 0));
      function showMarker() {
        const setMarkedRow = tracklist?.contentWindow?.setMarkedRow;
        if (setMarkedRow) {
          setMarkedRow(marked);
          // Hidden until now, so a reload never flashes the ▶ on the first row or text without its fonts.
          tracklist.contentDocument.fonts.ready.then(() => (tracklist.style.visibility = "visible"));
        }
        const position = document.getElementById("position");
        if (position) position.textContent = String(marked + 1);
        history.replaceState(null, "", "#" + (marked + 1));
      }
      tracklist?.addEventListener("load", showMarker);
      if (tracklist?.contentDocument?.readyState === "complete") showMarker();
      document.addEventListener("keydown", (event) => {
        if (ROWS === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        marked = Math.min(Math.max(marked + step, 0), ROWS - 1);
        showMarker();
      });

      // Reload whenever the server has checked the Episode Folder again since this page was made.
      new EventSource("/events").onmessage = (event) => {
        if (Number(event.data) !== VERSION) location.reload();
      };
    </script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
