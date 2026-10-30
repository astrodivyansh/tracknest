import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { btn, card, input, label } from "@/lib/ui";
import { requestPasswordReset } from "../actions";

export default function ForgotPasswordPage() {
  return (
    <div className={card}>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-4 text-sm text-muted-foreground">We&apos;ll email you a link to choose a new one.</p>
      <ActionForm action={requestPasswordReset} className="space-y-4">
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <button className={`${btn} w-full`}>Email me a reset link</button>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
