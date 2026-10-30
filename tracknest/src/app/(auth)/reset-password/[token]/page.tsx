import Link from "next/link";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { sha256 } from "@/lib/auth";
import { btn, card, input, label } from "@/lib/ui";
import { resetPassword } from "../../actions";

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  const [valid] = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));

  if (!valid) {
    return (
      <div className={card}>
        <h1 className="mb-2 text-lg font-semibold">Link not valid</h1>
        <p className="text-sm text-muted-foreground">
          This reset link has expired or was already used.{" "}
          <Link href="/forgot-password" className="font-medium text-primary">
            Ask for a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className={card}>
      <h1 className="mb-4 text-lg font-semibold">Choose a new password</h1>
      <ActionForm action={resetPassword.bind(null, token)} className="space-y-4">
        <label className={label}>
          New password (8+ characters)
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
        <button className={`${btn} w-full`}>Save password and sign in</button>
      </ActionForm>
      <p className="mt-4 text-xs text-muted-foreground">This signs you out on every other device.</p>
    </div>
  );
}
