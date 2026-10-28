import { z } from "zod";
import { CustodyError } from "./custody";

export type FormState = { error?: string; ok?: string } | undefined;

export const optText = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null);
export const optId = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((v) => v || null);
export const reqText = (label: string) => z.string().trim().min(1, `${label} is required`);

export const fields = (f: FormData) => Object.fromEntries(f) as Record<string, string>;

/** Turns rule-breaking errors into a message for the form; anything else (bugs, redirects) is rethrown. */
export async function handle(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    if (e instanceof CustodyError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0].message };
    if ((e as { cause?: { code?: string } })?.cause?.code === "23505") {
      return { error: "That value is already in use (for example the asset tag or email)." };
    }
    throw e;
  }
}
