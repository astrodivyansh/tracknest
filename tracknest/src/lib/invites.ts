import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { sha256 } from "./auth";
import { CustodyError } from "./custody";

/**
 * Turns a valid invite into an account (password or Google sign-up). `email`, when given, must match
 * the invited address, so a Google account can't claim someone else's invite.
 */
export async function redeemInvite(token: string, input: { name: string; passwordHash: string; email?: string }) {
  return db.transaction(async (tx) => {
    // Lock the invite so a double-submit can't create two accounts.
    const [invite] = await tx
      .select()
      .from(invites)
      .where(and(eq(invites.id, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .for("update");
    if (!invite) throw new CustodyError("This invite link is invalid, expired or already used.");
    if (input.email && input.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new CustodyError(`This invite is for ${invite.email}, but you signed in to Google as ${input.email}.`);
    }
    const [user] = await tx
      .insert(users)
      .values({ orgId: invite.orgId, name: input.name, email: invite.email, passwordHash: input.passwordHash, role: invite.role })
      .returning();
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
    return user.id;
  });
}
