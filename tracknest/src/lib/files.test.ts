import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { assetEvents, assetFiles, assets, organizations, users } from "@/db/schema";
import { nextTag, type Actor } from "./custody";
import { cleanName, detectType, forgetFile, recordFile } from "./files";
import { deleteObject, getObject, putObject } from "./storage";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

let actor: Actor;
let assetId: string;
const run = <T>(fn: Parameters<typeof withOrg<T>>[1]) => withOrg(actor.orgId, fn);

beforeAll(async () => {
  process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "tn-uploads-"));
  const [org] = await db.insert(organizations).values({ name: `Files ${Date.now()}` }).returning();
  const [u] = await db
    .insert(users)
    .values({ orgId: org.id, name: "Admin", email: `files-${Date.now()}@test.local`, passwordHash: "x", role: "owner" })
    .returning();
  actor = { id: u.id, name: u.name, orgId: org.id };
  assetId = (await run(async (tx) => (await tx.insert(assets).values({ orgId: org.id, tag: await nextTag(tx, org.id), name: "Van" }).returning())[0])).id;
});

describe("files", () => {
  it("detects types from the bytes, not the name", () => {
    expect(detectType(JPEG)).toEqual({ contentType: "image/jpeg", kind: "photo" });
    expect(detectType(PDF)).toEqual({ contentType: "application/pdf", kind: "document" });
    expect(detectType(HTML)).toBeNull();
  });

  it("keeps only a safe base name", () => {
    expect(cleanName("../../etc/passwd")).toBe("passwd");
    expect(cleanName('C:\\Users\\me\\inv"oice\n.pdf')).toBe("invoice.pdf");
    expect(cleanName("")).toBe("file");
  });

  it("records, stores, reads back and removes a file, with history", async () => {
    const file = await run((tx) => recordFile(tx, actor, { assetId, filename: "front.jpg", bytes: JPEG }));
    await putObject(file.storageKey, JPEG);
    expect(new Uint8Array(await getObject(file.storageKey))).toEqual(JPEG);
    expect(file).toMatchObject({ kind: "photo", contentType: "image/jpeg", size: JPEG.length });

    const key = await run((tx) => forgetFile(tx, actor, { assetId, fileId: file.id }));
    await deleteObject(key);
    expect(await readdir(path.join(process.env.UPLOAD_DIR!, actor.orgId))).toEqual([]);
    const events = await run((tx) => tx.select().from(assetEvents).where(eq(assetEvents.assetId, assetId)).orderBy(assetEvents.occurredAt));
    expect(events.map((e) => e.type)).toEqual(["file_added", "file_removed"]);
  });

  it("refuses disguised or empty files and storage keys that escape the folder", async () => {
    await expect(run((tx) => recordFile(tx, actor, { assetId, filename: "photo.jpg", bytes: HTML }))).rejects.toThrow(/only JPEG/);
    await expect(run((tx) => recordFile(tx, actor, { assetId, filename: "x.pdf", bytes: new Uint8Array() }))).rejects.toThrow(/empty/);
    expect(await run((tx) => tx.select().from(assetFiles).where(eq(assetFiles.assetId, assetId)))).toEqual([]);
    await expect(putObject("../../etc/x", JPEG)).rejects.toThrow(/bad storage key/);
  });
});
