import Link from "next/link";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites, organizations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { GoogleButton } from "@/components/google-button";
import { googleEnabled } from "@/lib/google";
import { sha256 } from "@/lib/auth";
import { btn, card, input, label } from "@/lib/ui";
import { acceptInvite } from "../../actions";

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const [invite] = await db
    .select({ email: invites.email, role: invites.role, orgName: organizations.name, invitedBy: invites.invitedBy })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(and(eq(invites.id, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));

  if (!invite) {
    return (
      <div className={card}>
        <h1 className="mb-2 text-lg font-semibold">Invite not valid</h1>
        <p className="text-sm text-muted-foreground">
          This link has expired or was already used. Ask your admin for a new one, or{" "}
          <Link href="/login" className="font-medium text-primary">sign in</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className={card}>
      <h1 className="text-lg font-semibold">Join {invite.orgName}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {invite.invitedBy} invited <span className="font-medium">{invite.email}</span> as{" "}
        <span className="capitalize">{invite.role}</span>.
      </p>
      {typeof error === "string" && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {googleEnabled() && (
        <div className="mb-4 space-y-4">
          <GoogleButton invite={token} label={`Join with Google as ${invite.email}`} />
          <p className="text-center text-xs text-muted-foreground">or choose a password</p>
        </div>
      )}
      <ActionForm action={acceptInvite.bind(null, token)} className="space-y-4">
        <label className={label}>
          Your name
          <input name="name" required autoComplete="name" className={input} />
        </label>
        <label className={label}>
          Choose a password (8+ characters)
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
        <button className={`${btn} w-full`}>Create account</button>
      </ActionForm>
    </div>
  );
}
