import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { apiKeys, invites, securityGroups, users } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { btn, btnSecondary, card, h1, h2, input, label, td, th } from "@/lib/ui";
import { setUserGroup } from "../setup/groups/actions";
import { changeRole, createApiKey, createInvite, removeUser, revokeApiKey, revokeInvite, toggleAlerts } from "./actions";

const ROLE_HELP = {
  viewer: "Can see assets and history",
  manager: "Can also add assets, check in/out and import",
  admin: "Can also manage setup and team",
};

export default async function TeamPage() {
  const user = await requireUser("admin");
  const [members, pending, keys, groups] = await Promise.all([
    db.select().from(users).where(eq(users.orgId, user.orgId)).orderBy(asc(users.createdAt)),
    db
      .select()
      .from(invites)
      .where(and(eq(invites.orgId, user.orgId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt)),
    db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, user.orgId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt)),
    withOrg(user.orgId, (tx) => tx.select({ id: securityGroups.id, name: securityGroups.name }).from(securityGroups).orderBy(asc(securityGroups.name))),
  ]);

  return (
    <>
      <h1 className={h1}>Team</h1>

      <section className={card}>
        <h2 className={h2}>Invite a teammate</h2>
        <ActionForm action={createInvite} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
          <label className={`${label} sm:col-span-2`}>
            Email
            <input name="email" type="email" required className={input} />
          </label>
          <label className={label}>
            Role
            <select name="role" defaultValue="manager" className={input}>
              {Object.entries(ROLE_HELP).map(([r, help]) => (
                <option key={r} value={r}>
                  {r} — {help}
                </option>
              ))}
            </select>
          </label>
          <button className={btn}>Create invite link</button>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>Members ({members.length})</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Role</th>
                <th className={th}>Security group</th>
                <th className={th}>Two-step sign-in</th>
                <th className={th}>Daily alert email</th>
                <th className={th}>Joined</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => {
                const locked = m.id === user.id || m.role === "owner";
                return (
                  <tr key={m.id}>
                    <td className={td}>{m.name}</td>
                    <td className={td}>{m.email}</td>
                    <td className={td}>
                      {locked ? (
                        <span className="capitalize">{m.role}</span>
                      ) : (
                        <ActionForm action={changeRole.bind(null, m.id)} className="flex gap-2">
                          <select name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`} className={`${input} w-32`}>
                            {Object.keys(ROLE_HELP).map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                          <button className={btnSecondary}>Save</button>
                        </ActionForm>
                      )}
                    </td>
                    <td className={td}>
                      {m.role !== "manager" ? (
                        <span className="text-muted-foreground">{m.role === "viewer" ? "View only" : "Everything"}</span>
                      ) : (
                        <ActionForm action={setUserGroup.bind(null, m.id)} className="flex gap-2">
                          <select name="groupId" defaultValue={m.groupId ?? ""} aria-label={`Security group for ${m.name}`} className={`${input} w-40`}>
                            <option value="">No group (everything)</option>
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                          <button className={btnSecondary}>Save</button>
                        </ActionForm>
                      )}
                    </td>
                    <td className={td}>{m.totpEnabled ? "On" : <span className="text-muted-foreground">Off</span>}</td>
                    <td className={td}>
                      {m.role === "viewer" ? (
                        <span className="text-muted-foreground">Managers and up</span>
                      ) : (
                        <ActionForm action={toggleAlerts.bind(null, m.id)}>
                          <button
                            aria-label={`Daily alert email for ${m.name}: ${m.emailAlerts ? "on, click to turn off" : "off, click to turn on"}`}
                            className={`rounded px-2 py-0.5 text-xs ${m.emailAlerts ? "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300" : "bg-muted text-muted-foreground"}`}
                          >
                            {m.emailAlerts ? "On" : "Off"}
                          </button>
                        </ActionForm>
                      )}
                    </td>
                    <td className={td}>{fmtDate(m.createdAt, user.timezone)}</td>
                    <td className={td}>
                      {!locked && (
                        <ActionForm action={removeUser.bind(null, m.id)}>
                          <button className="text-sm text-red-600 dark:text-red-400 hover:underline">Remove</button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className={h2}>Pending invites</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {i.email} · <span className="capitalize">{i.role}</span> · invited by {i.invitedBy} · expires{" "}
                  {fmtDate(i.expiresAt, user.timezone)}
                </span>
                <ActionForm action={revokeInvite.bind(null, i.id)}>
                  <button className="text-red-600 dark:text-red-400 hover:underline">Revoke</button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className={h2}>API keys</h2>
        <p className="text-sm text-muted-foreground">
          Let other systems (HR, ERP, helpdesk) read or update assets. Send the key as <code>Authorization: Bearer tn_…</code> to{" "}
          <code>/api/v1</code>; the endpoints are described in <code>openapi.yaml</code>. Changes made with a key appear in history as
          &ldquo;API key: name&rdquo;.
        </p>
        {keys.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{k.name}</span> · <code>{k.prefix}…</code> ·{" "}
                  {k.scope === "write" ? "read and write" : "read only"} · created by {k.createdBy} ·{" "}
                  {k.lastUsedAt ? `last used ${fmtDateTime(k.lastUsedAt, user.timezone)}` : "never used"}
                </span>
                <ActionForm action={revokeApiKey.bind(null, k.id)}>
                  <button className="text-red-600 dark:text-red-400 hover:underline">Revoke</button>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createApiKey} className={`${card} grid gap-3 sm:grid-cols-4 sm:items-end`}>
          <label className={`${label} sm:col-span-2`}>
            Name
            <input name="name" required placeholder="e.g. HR system" className={input} />
          </label>
          <label className={label}>
            Access
            <select name="scope" defaultValue="read" className={input}>
              <option value="read">Read only</option>
              <option value="write">Read and write</option>
            </select>
          </label>
          <button className={btn}>Create key</button>
        </ActionForm>
      </section>
    </>
  );
}
