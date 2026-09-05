import { canViewBoardContent } from "@/lib/access";
import { HTML_TO_IMAGE_SOURCE } from "@/generated/html-to-image";
import { getBoardById } from "@/lib/board-data";
import { get } from "@/lib/db";
import { logError } from "@/lib/log";
import { readUpload } from "@/lib/storage";

// Uploaded student HTML runs with an opaque origin (no allow-same-origin), so it can never read
// our cookies or DOM. Popups are allowed but stay sandboxed — letting them escape would give an
// upload a fully-privileged window under our domain.
const SANDBOX_CSP = "sandbox allow-scripts allow-popups allow-modals allow-forms;";

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

type GalleryCard = { id: string; board_id: string; file_id: string | null };

/** How wide the stored snapshot is. Enough to stay sharp on a 2x gallery card. */
const THUMB_WIDTH = 900;
/** Guards against photographing an endless page. */
const MAX_CAPTURE = { width: 1600, height: 2400 };
/** Used when the frame reports no layout at all, which a background tab does. */
const DEFAULT_CAPTURE = { width: 1024, height: 768 };

/**
 * Appended to a work when it is served for capture, so the picture the gallery shows is taken
 * once — when the work is registered — instead of every card in the grid re-running its author's
 * page on every visit.
 *
 * It rides along inside the document because of where it has to run. The work is served into a
 * sandboxed, opaque origin; nothing outside can reach in, which is the whole point, so the only
 * place a photograph can be taken from is within. Two consequences shaped this:
 *
 *  - The library is inlined rather than linked. A null-origin document is refused when it asks us
 *    for a script, so a <script src> here simply never loads.
 *  - It is html-to-image and not html2canvas. html2canvas clones the page into an iframe of its
 *    own and then reads that iframe's document — across two *different* opaque origins, which the
 *    browser blocks. html-to-image stays inside this document.
 *
 * What comes back out is a postMessage the parent treats as untrusted — see captureGalleryThumb().
 */
const CAPTURE_BOOTSTRAP = `
<script>${HTML_TO_IMAGE_SOURCE.replace(/<\/script/gi, "<\/script")}</script>
<script>
(function () {
  var sent = false;
  function send(payload) { if (sent) return; sent = true; try { parent.postMessage(payload, "*"); } catch (e) {} }
  function fail(e) { send({ openpadThumb: null, reason: String((e && e.message) || e) }); }

  function shoot() {
    if (!window.htmlToImage) return send({ openpadThumb: null, reason: "no-lib" });
    var body = document.body;
    if (!body) return send({ openpadThumb: null, reason: "no-body" });
    // Explicit dimensions rather than the element's own box: a background tab lays nothing out,
    // and a zero-sized box would produce a zero-sized picture. The clone is rendered at this size
    // inside the SVG, so the snapshot comes out right either way.
    var width = Math.min(Math.max(body.scrollWidth || 0, document.documentElement.clientWidth || 0) || ${DEFAULT_CAPTURE.width}, ${MAX_CAPTURE.width});
    var height = Math.min(Math.max(body.scrollHeight || 0, document.documentElement.clientHeight || 0) || ${DEFAULT_CAPTURE.height}, ${MAX_CAPTURE.height});
    var scale = Math.min(1, ${THUMB_WIDTH} / width);
    var outWidth = Math.max(1, Math.round(width * scale));
    var outHeight = Math.max(1, Math.round(height * scale));

    htmlToImage.toSvg(body, {
      width: width, height: height, backgroundColor: "#ffffff", cacheBust: false,
      // Embedding webfonts means fetching their stylesheet, which a null origin cannot do; the
      // attempt only stalls the capture. The snapshot falls back to the same family stack the
      // browser would use without them.
      skipFonts: true,
    })
      // decode(), not the library's own rasteriser: that one waits on requestAnimationFrame, which
      // a browser never runs for a tab nobody is looking at — and a student who uploads and then
      // switches away is exactly the case this has to survive. (createImageBitmap would be tidier
      // still, but Chrome cannot decode SVG through it.)
      .then(function (url) {
        var image = new Image();
        image.src = url;
        return (image.decode ? image.decode() : new Promise(function (ok, no) { image.onload = ok; image.onerror = no; }))
          .then(function () { return image; });
      })
      .then(function (image) {
        var canvas = document.createElement("canvas");
        canvas.width = outWidth;
        canvas.height = outHeight;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, outWidth, outHeight);
        send({ openpadThumb: canvas.toDataURL("image/jpeg", 0.72) });
      })
      .catch(fail);
  }

  // Give the work a moment to lay itself out, and never leave the parent waiting forever.
  setTimeout(function () { try { shoot(); } catch (e) { fail(e); } }, 700);
  setTimeout(function () { send({ openpadThumb: null, reason: "timeout" }); }, 12000);
})();
</script>`;

// Shared by /api/embed/[id] (iframe preview) and /g/[code] (short share link).
export async function serveGalleryWork(card: GalleryCard | undefined, capture = false) {
  if (!card || !card.file_id) return textResponse("작품을 찾을 수 없습니다.", 404);
  const board = (await getBoardById(card.board_id));
  if (!board) return textResponse("보드를 찾을 수 없습니다.", 404);
  if (!(await canViewBoardContent(board))) return textResponse("이 작품에 접근할 권한이 없습니다.", 403);
  const file = (await get<{ stored_name: string }>("SELECT stored_name FROM files WHERE id = ?", card.file_id));
  if (!file) return textResponse("파일을 찾을 수 없습니다.", 404);
  try {
    const data = await readUpload(file.stored_name);
    const body = capture
      ? new TextEncoder().encode(data.toString("utf8") + CAPTURE_BOOTSTRAP)
      : new Uint8Array(data);
    return new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": SANDBOX_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": capture ? "no-store" : "private, max-age=60",
      },
    });
  } catch (error) {
    logError("gallery.read", error, { cardId: card.id, storedName: file.stored_name });
    return textResponse("작품을 불러올 수 없습니다.", 502);
  }
}
