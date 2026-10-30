import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// shortcut: local disk only (fine on one VPS with backups); add an S3/R2 driver behind these three functions to scale out.
// turbopackIgnore: runtime data, not source; stops the build tracing the whole project into the server bundle.
const root = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR || ".data/uploads");

// Keys are always "<orgId>/<uuid>", generated server-side; refuse anything else so a key can't escape the root.
function pathOf(key: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error(`bad storage key ${key}`);
  return path.join(/* turbopackIgnore: true */ root(), key);
}

export async function putObject(key: string, bytes: Uint8Array) {
  const p = pathOf(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes, { flag: "wx" }); // never overwrite
}

export const getObject = (key: string) => readFile(pathOf(key));
export const deleteObject = (key: string) => rm(pathOf(key), { force: true });
