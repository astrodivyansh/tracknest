import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { assetFiles } from "@/db/schema";
import { CustodyError, lockAsset, recordEvent, type Actor } from "./custody";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_ASSET = 50;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** File type from its first bytes. Only these types are accepted. */
export function detectType(b: Uint8Array): { contentType: string; kind: "photo" | "document" } | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", kind: "photo" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", kind: "photo" };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { contentType: "image/webp", kind: "photo" };
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf", kind: "document" };
  return null;
}

/** Keeps just a readable base name: no folders, no control characters, bounded length. */
export const cleanName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200) || "file";

/**
 * Validates an upload and records it. The caller stores the bytes under the returned key
 * (and deletes them again if the transaction fails).
 */
export async function recordFile(tx: Tx, actor: Actor, input: { assetId: string; filename: string; bytes: Uint8Array }) {
  const asset = await lockAsset(tx, input.assetId);
  const filename = cleanName(input.filename);
  if (input.bytes.length === 0) throw new CustodyError(`${filename} is empty.`);
  if (input.bytes.length > MAX_FILE_BYTES) throw new CustodyError(`${filename} is larger than 10 MB.`);
  const type = detectType(input.bytes);
  if (!type) throw new CustodyError(`${filename}: only JPEG, PNG, WebP photos and PDF documents can be uploaded.`);
  const [{ n }] = await tx.select({ n: count() }).from(assetFiles).where(eq(assetFiles.assetId, asset.id));
  if (n >= MAX_FILES_PER_ASSET) throw new CustodyError(`An asset can have at most ${MAX_FILES_PER_ASSET} files.`);

  const [file] = await tx
    .insert(assetFiles)
    .values({
      orgId: actor.orgId,
      assetId: asset.id,
      ...type,
      filename,
      size: input.bytes.length,
      storageKey: `${actor.orgId}/${randomUUID()}`,
      uploadedBy: actor.name,
    })
    .returning();
  await recordEvent(tx, actor, asset.id, "file_added", { fileId: file.id, filename, kind: file.kind });
  return file;
}

/** Removes the record; the caller deletes the returned key from storage after the transaction commits. */
export async function forgetFile(tx: Tx, actor: Actor, input: { assetId: string; fileId: string }) {
  const [file] = await tx
    .delete(assetFiles)
    .where(and(eq(assetFiles.id, input.fileId), eq(assetFiles.assetId, input.assetId)))
    .returning();
  if (!file) throw new CustodyError("File not found.");
  await recordEvent(tx, actor, file.assetId, "file_removed", { filename: file.filename, kind: file.kind });
  return file.storageKey;
}
