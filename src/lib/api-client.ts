/**
 * Browser-side helpers for talking to our own API. Nothing here touches React state, which is the
 * point: it can be read, reasoned about and changed without holding a 1,500-line component in your
 * head. Server code must not import this — see storage.ts for the other side of the upload.
 */

/** Prefers the API's Korean error message, falling back to the caller's wording. */
export async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return data.error ?? fallback;
}

/**
 * Prepares a FormData for the cards route, sending the bytes the shortest way available.
 *
 * Serverless functions cap request bodies at 4.5MB, under the 10MB attachment limit, so where
 * object storage is configured the browser uploads straight to the bucket and posts only the
 * resulting object name. Self-hosted deployments have no such cap and keep posting the file.
 */
export async function attachFile(boardId: string, form: FormData, file: File) {
  const throughApi = () => { form.append("file", file); return form; };

  let ticket: Response;
  try {
    ticket = await fetch(`/api/boards/${boardId}/uploads`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, size: file.size }),
    });
  } catch {
    return throughApi(); // could not reach the ticket route at all
  }
  // 501 = this deployment has no bucket and uploads through the API.
  if (ticket.status === 501) return throughApi();
  if (!ticket.ok) throw new Error(await responseError(ticket, "업로드를 준비하지 못했습니다."));

  // Past this point the bucket is the only route the bytes can take, so a failure here must be
  // reported rather than retried through the API. Falling back would work in development and then
  // fail on serverless with an unexplained 413 for anything over 4.5MB — which is exactly how a
  // Content-Security-Policy that blocked this PUT went unnoticed.
  const { uploadUrl, storedName } = await ticket.json() as { uploadUrl: string; storedName: string };
  let put: Response;
  try {
    put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  } catch {
    throw new Error("스토리지에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
  }
  if (!put.ok) throw new Error("스토리지 업로드에 실패했습니다.");

  form.append("storedName", storedName);
  form.append("fileName", file.name);
  form.append("fileType", file.type || "application/octet-stream");
  return form;
}

/**
 * Photographs a freshly registered gallery work, once, so the grid can show a picture instead of
 * running every student's program on every visit.
 *
 * The work is loaded in a hidden sandboxed frame that carries the capture bootstrap (see
 * src/lib/gallery.ts) and reports back by postMessage. Everything about that reply is untrusted —
 * it comes from the work's own code — so it is matched to this frame, checked to be a JPEG data
 * URL, and size-capped before it is sent on. A failure is not an error the author needs to see:
 * the card simply keeps the live frame it had before.
 */
export async function captureGalleryThumb(cardId: string, timeoutMs = 15000) {
  if (typeof window === "undefined") return false;
  const frame = document.createElement("iframe");
  // Deliberately no sandbox attribute. The response sandboxes itself — its Content-Security-Policy
  // carries the sandbox directive, which is what puts the work in an opaque origin where it cannot
  // reach our DOM or cookies (verified: contentDocument is inaccessible). Adding the attribute on
  // top of that CSP stops the document's scripts running at all, which would include the snapshot
  // bootstrap we are here to run.
  frame.setAttribute("aria-hidden", "true");
  // Rendered but invisible, rather than parked off-screen: a frame the browser decides is not
  // being shown lays nothing out, and the snapshot would come back the size of nothing.
  frame.style.cssText = "position:fixed;top:0;left:0;width:1024px;height:768px;border:0;"
    + "opacity:0;pointer-events:none;z-index:-2147483647;";

  const dataUrl = await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const payload = event.data as { openpadThumb?: unknown } | null;
      if (!payload || typeof payload !== "object" || !("openpadThumb" in payload)) return;
      const thumb = payload.openpadThumb;
      const ok = typeof thumb === "string"
        && thumb.startsWith("data:image/jpeg;base64,")
        && thumb.length < 4_000_000;
      finish(ok ? (thumb as string) : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    frame.src = `/api/embed/${cardId}?capture=1`;
    document.body.appendChild(frame);
  });
  if (!dataUrl) return false;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append("thumb", new File([blob], "thumb.jpg", { type: "image/jpeg" }));
    const response = await fetch(`/api/cards/${cardId}/thumb`, { method: "POST", body: form });
    return response.ok;
  } catch {
    return false;
  }
}
