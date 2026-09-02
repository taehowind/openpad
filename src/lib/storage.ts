import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { logError } from "@/lib/log";

/**
 * Single source of truth for where uploads live. Two backends:
 *
 *   - local  — a directory on a volume. The default, used by self-hosted deployments.
 *   - bucket — S3-compatible object storage (Supabase Storage), when SUPABASE_URL and
 *              SUPABASE_SERVICE_ROLE_KEY are set. Required on serverless, whose filesystem is
 *              ephemeral and per-instance.
 *
 * Callers only ever pass a `stored_name` from the database, and every path is run through
 * basename() so a crafted name can never escape the upload location.
 */
export function isObjectStorage() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function bucket() {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
}

function objectUrl(storedName: string) {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/${bucket()}/${encodeURIComponent(path.basename(storedName))}`;
}

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}

export function uploadDir() {
  return process.env.UPLOAD_DIR ?? "/data/uploads";
}

export function uploadPath(storedName: string) {
  return path.join(/*turbopackIgnore: true*/ uploadDir(), path.basename(storedName));
}

export async function readUpload(storedName: string): Promise<Buffer> {
  if (!isObjectStorage()) return fs.readFile(uploadPath(storedName));
  const response = await fetch(objectUrl(storedName), { headers: serviceHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error(`storage read failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Best-effort delete. Failure is not worth failing the caller's request over — the card is already
 * gone either way — but it does leave an object nobody will ever reference again, so it is logged
 * rather than dropped. Silent failures here are how a bucket fills with orphans.
 */
/**
 * Opens an upload for streaming, or null if there is no such object.
 *
 * readUpload pulls the whole file into memory, which is fine for the gallery's 5MB HTML and wrong
 * for a 100MB teacher attachment: on serverless that is 100MB of function memory held for the
 * length of the download, per concurrent reader. This hands back a stream instead, so the bytes
 * pass through rather than pile up.
 *
 * Absent and broken are different answers. A missing object returns null — the reader asked for
 * something that is not there — while a backend that failed throws, because that is ours to fix
 * and the caller should say so rather than claim the file never existed.
 */
export type UploadStream = { body: ReadableStream<Uint8Array>; size: number | null };

export async function openUpload(storedName: string): Promise<UploadStream | null> {
  if (!isObjectStorage()) {
    const target = uploadPath(storedName);
    let size: number;
    try {
      size = (await fs.stat(target)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return { body: Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>, size };
  }

  const response = await fetch(objectUrl(storedName), { headers: serviceHeaders(), cache: "no-store" });
  // Supabase answers a missing object with 400 as readily as 404, so both mean "not there".
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok || !response.body) throw new Error(`storage read failed: ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  return { body: response.body, size: Number.isFinite(declared) && declared > 0 ? declared : null };
}

export async function removeUpload(storedName: string) {
  if (!isObjectStorage()) {
    await fs.unlink(uploadPath(storedName)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") logError("storage.remove", error, { storedName });
    });
    return;
  }
  try {
    const response = await fetch(objectUrl(storedName), { method: "DELETE", headers: serviceHeaders() });
    if (!response.ok && response.status !== 404) logError("storage.remove", new Error(`status ${response.status}`), { storedName });
  } catch (error) {
    logError("storage.remove", error, { storedName });
  }
}

/**
 * Writes without overwriting: the local path uses the "wx" flag and the bucket path relies on
 * upsert being off, so a colliding name fails loudly rather than clobbering another board's file.
 */
export async function writeUpload(storedName: string, data: Buffer, contentType = "application/octet-stream") {
  if (!isObjectStorage()) {
    await fs.mkdir(uploadDir(), { recursive: true });
    const target = uploadPath(storedName);
    await fs.writeFile(target, data, { flag: "wx" });
    return target;
  }
  const response = await fetch(objectUrl(storedName), {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": contentType, "x-upsert": "false" },
    body: new Uint8Array(data),
  });
  if (!response.ok) throw new Error(`storage write failed: ${response.status} ${await response.text()}`);
  return objectUrl(storedName);
}

/**
 * A short-lived URL the browser can PUT straight to, bypassing the serverless request body
 * limit. Null on the local backend, where uploads go through the API as normal.
 */
export async function createUploadTicket(storedName: string) {
  if (!isObjectStorage()) return null;
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const name = path.basename(storedName);
  const response = await fetch(`${base}/storage/v1/object/upload/sign/${bucket()}/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  if (!response.ok) throw new Error(`storage sign failed: ${response.status}`);
  const { url } = (await response.json()) as { url: string };
  return { uploadUrl: `${base}/storage/v1${url}`, storedName: name };
}

/** Confirms an object really landed, so a client cannot register a card for a file it never sent. */
export async function uploadExists(storedName: string) {
  if (!isObjectStorage()) {
    return fs.stat(uploadPath(storedName)).then(() => true).catch(() => false);
  }
  const response = await fetch(objectUrl(storedName), { method: "HEAD", headers: serviceHeaders() });
  return response.ok;
}

export async function uploadSize(storedName: string) {
  if (!isObjectStorage()) return fs.stat(uploadPath(storedName)).then((s) => s.size).catch(() => 0);
  const response = await fetch(objectUrl(storedName), { method: "HEAD", headers: serviceHeaders() });
  return Number(response.headers.get("content-length") ?? 0);
}

// Derives the stored file name from an upload. The extension is sanitised because it ends up
// in a path or object key; the id keeps the name unique.
export function storedNameFor(fileId: string, originalName: string, fallbackExtension = "") {
  const extension = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  return `${fileId}${extension === "." || !extension ? fallbackExtension : extension}`;
}

// Content-Type comes from the uploader, so it is only echoed back when it looks like a MIME type.
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

export function safeMimeType(value: string | null | undefined) {
  return value && MIME_PATTERN.test(value) ? value : "application/octet-stream";
}

// Types the browser may render in place. Everything else is forced to download, so an uploaded
// .html or .svg can never execute on our origin.
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "application/pdf"]);

export function isInlineViewable(mimeType: string) {
  return INLINE_TYPES.has(mimeType);
}
