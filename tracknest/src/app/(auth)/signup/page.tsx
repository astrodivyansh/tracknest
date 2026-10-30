import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { btn, card, input, label } from "@/lib/ui";
import { signup } from "../actions";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
// Some ICU builds list India only as "Asia/Calcutta"; keep the default present so it's actually selected.
const DEFAULT_TZ = "Asia/Kolkata";
const TIMEZONES = [...new Set([DEFAULT_TZ, ...Intl.supportedValuesOf("timeZone")])];

export default function SignupPage() {
  return (
    <div className={card}>
      <h1 className="mb-4 text-lg font-semibold">Create your organization</h1>
      <ActionForm action={signup} className="space-y-4">
        <label className={label}>
          Organization name
          <input name="orgName" required className={input} />
        </label>
        <label className={label}>
          Your name
          <input name="name" required autoComplete="name" className={input} />
        </label>
        <label className={label}>
          Work email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className={label}>
          Password (8+ characters)
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Currency
            <select name="currency" defaultValue="INR" className={input}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Timezone
            <select name="timezone" defaultValue={DEFAULT_TZ} className={input}>
              {TIMEZONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <button className={`${btn} w-full`}>Create organization</button>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary">
          Sign in
        </Link>
      </p>
    </div>
  );
}
