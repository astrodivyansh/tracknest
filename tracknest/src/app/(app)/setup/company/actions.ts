"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { DATE_FORMATS, organizations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CustodyError } from "@/lib/custody";
import { detectType } from "@/lib/files";
import { fields, handle, reqText, type FormState } from "@/lib/form";
import { deleteObject, putObject } from "@/lib/storage";

const MAX_LOGO_BYTES = 1024 * 1024;

// Intl's own list omits aliases such as Asia/Kolkata (it lists Asia/Calcutta), so ask Intl to use the zone.
function validZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function saveCompany(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const input = z
      .object({
        name: reqText("Organization name"),
        currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like INR or USD"),
        timezone: z.string().refine(validZone, "Choose a timezone"),
        dateFormat: z.enum(DATE_FORMATS),
        fyStartMonth: z.coerce.number().int().min(1).max(12),
        tagPrefix: z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "Tag prefix: 1–8 capital letters or digits"),
      })
      .parse(fields(form));
    await withOrg(user.orgId, (tx) => tx.update(organizations).set(input).where(eq(organizations.id, user.orgId)));
    revalidatePath("/", "layout");
    return { ok: "Company settings saved." };
  });
}

export async function uploadLogo(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new CustodyError("Choose an image.");
    if (file.size > MAX_LOGO_BYTES) throw new CustodyError("The logo must be 1 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (detectType(bytes)?.kind !== "photo") throw new CustodyError("The logo must be a JPEG, PNG or WebP image.");
    const key = `${user.orgId}/${randomUUID()}`;
    await putObject(key, bytes);
    const [old] = await withOrg(user.orgId, async (tx) => {
      const prev = await tx.select({ key: organizations.logoKey }).from(organizations).where(eq(organizations.id, user.orgId));
      await tx.update(organizations).set({ logoKey: key }).where(eq(organizations.id, user.orgId));
      return prev;
    }).catch(async (e) => {
      await deleteObject(key);
      throw e;
    });
    if (old?.key) await deleteObject(old.key);
    revalidatePath("/", "layout");
    return { ok: "Logo updated." };
  });
}

export async function removeLogo(): Promise<FormState> {
  return handle(async () => {
    const user = await requireUser("admin");
    const [old] = await withOrg(user.orgId, async (tx) => {
      const prev = await tx.select({ key: organizations.logoKey }).from(organizations).where(eq(organizations.id, user.orgId));
      await tx.update(organizations).set({ logoKey: null }).where(eq(organizations.id, user.orgId));
      return prev;
    });
    if (old?.key) await deleteObject(old.key);
    revalidatePath("/", "layout");
  });
}
