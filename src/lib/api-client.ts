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
