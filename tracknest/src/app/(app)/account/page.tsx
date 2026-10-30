import { eq } from "drizzle-orm";
import bwipjs from "bwip-js/node";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { canEdit, requireUser } from "@/lib/auth";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { otpauthUri } from "@/lib/totp";
import { changePassword, confirmTwoStep, disableTwoStep, signOutOthers, startTwoStep, toggleMyAlerts, updateName } from "./actions";

export default async function AccountPage() {
  const user = await requireUser();
  const [me] = await db
    .select({ emailAlerts: users.emailAlerts, totpEnabled: users.totpEnabled, totpSecret: users.totpSecret })
    .from(users)
    .where(eq(users.id, user.id));
  const { emailAlerts } = me;
  const settingUp = !me.totpEnabled && me.totpSecret;
  const qr = settingUp ? bwipjs.toSVG({ bcid: "qrcode", text: otpauthUri(me.totpSecret!, user.email), scale: 3 }) : null;

  return (
    <>
      <div>
        <h1 className={h1}>My account</h1>
        <p className="text-sm text-muted-foreground">
          {user.email} · <span className="capitalize">{user.role}</span> at {user.orgName}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>Name</h2>
          <ActionForm action={updateName} className="mt-3 flex gap-2">
            <input name="name" required defaultValue={user.name} aria-label="Your name" autoComplete="name" className={input} />
            <button className={btn}>Save</button>
          </ActionForm>
        </section>

        <section className={card}>
          <h2 className={h2}>Password</h2>
          <ActionForm action={changePassword} className="mt-3 space-y-3">
            <label className={label}>
              Current password
              <input name="current" type="password" required autoComplete="current-password" className={input} />
            </label>
            <label className={label}>
              New password (8+ characters)
              <input name="next" type="password" required minLength={8} autoComplete="new-password" className={input} />
            </label>
            <button className={btn}>Change password</button>
          </ActionForm>
        </section>

        {canEdit(user) && (
          <section className={card}>
            <h2 className={h2}>Daily alert email</h2>
            <p className="my-2 text-sm text-muted-foreground">
              One email a day with overdue returns, items due today, upcoming dates and maintenance. Currently{" "}
              <span className="font-medium">{emailAlerts ? "on" : "off"}</span>.
            </p>
            <ActionForm action={toggleMyAlerts}>
              <button className={btnSecondary}>{emailAlerts ? "Turn off" : "Turn on"}</button>
            </ActionForm>
          </section>
        )}

        <section className={`${card} md:col-span-2`}>
          <h2 className={h2}>Two-step sign-in</h2>
          {me.totpEnabled ? (
            <>
              <p className="my-2 text-sm">
                <span className="font-medium text-green-700 dark:text-green-400">On.</span> Signing in needs your password and a code from your authenticator app.
              </p>
              <ActionForm action={disableTwoStep} className="flex flex-wrap items-end gap-2">
                <label className={label}>
                  Current code
                  <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className={`${input} w-32`} />
                </label>
                <button className={btnSecondary}>Turn off</button>
              </ActionForm>
            </>
          ) : settingUp ? (
            <div className="mt-3 flex flex-wrap items-start gap-6">
              {/* White in dark mode too, so it scans. */}
              <div className="w-44 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: qr! }} />
              <div className="space-y-3 text-sm">
                <p>1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
                <p>
                  Can&apos;t scan? Enter this key: <code className="rounded bg-muted px-1 font-mono text-xs break-all">{me.totpSecret!.match(/.{1,4}/g)!.join(" ")}</code>
                </p>
                <ActionForm action={confirmTwoStep} className="flex flex-wrap items-end gap-2">
                  <label className={label}>
                    2. Enter the 6-digit code it shows
                    <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className={`${input} w-32`} />
                  </label>
                  <button className={btn}>Turn on</button>
                </ActionForm>
                <ActionForm action={disableTwoStep}>
                  <button className="text-sm text-muted-foreground hover:underline">Cancel set-up</button>
                </ActionForm>
              </div>
            </div>
          ) : (
            <>
              <p className="my-2 text-sm text-muted-foreground">Protect your account with a code from an authenticator app on your phone, as well as your password.</p>
              <ActionForm action={startTwoStep}>
                <button className={btnSecondary}>Set up two-step sign-in</button>
              </ActionForm>
            </>
          )}
        </section>

        <section className={card}>
          <h2 className={h2}>Devices</h2>
          <p className="my-2 text-sm text-muted-foreground">Lost a phone or signed in on a shared computer? Sign out everywhere except here.</p>
          <ActionForm action={signOutOthers}>
            <button className={btnSecondary}>Sign out of other devices</button>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
