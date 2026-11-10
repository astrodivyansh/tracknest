import { ActionForm } from "@/components/action-form";
import { isAdmin, requireUser } from "@/lib/auth";
import { EXPORTS } from "@/lib/data-export";
import { ASSET_TEMPLATE, MAX_IMPORT_ROWS, PERSON_TEMPLATE } from "@/lib/import";
import { IMPORTERS } from "@/lib/import-more";
import { can } from "@/lib/permissions";
import { btn, card, h1, h2, input } from "@/lib/ui";
import { importAssetsAction, importPeopleAction, importTableAction } from "./actions";

const csvHref = (csv: string) => `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

export default async function ImportPage() {
  const user = await requireUser("manager");
  return (
    <>
      <div>
        <h1 className={h1}>Import and export</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV file (up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows). If any row has a problem, nothing is imported and
          you get a list of rows to fix.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Section
          title="Assets"
          template={ASSET_TEMPLATE}
          file="assets-template.csv"
          action={importAssetsAction}
          notes={[
            "Only “name” is required. Leave “tag” empty to number assets automatically.",
            "Sites and locations must already exist under Setup. Missing categories and departments are created.",
            "Dates as YYYY-MM-DD or DD/MM/YYYY. Cost as a plain number.",
            "Custom fields (Setup → Custom asset fields) are filled from columns with the same name.",
          ]}
        />
        <Section
          title="People"
          template={PERSON_TEMPLATE}
          file="people-template.csv"
          action={importPeopleAction}
          notes={[
            "Only “name” is required. Missing departments are created.",
            "“work_location” is office or home (also accepts WFO and WFH).",
            "People whose email or employee ID is already on file are skipped, so you can re-upload safely.",
          ]}
        />
        {Object.entries(IMPORTERS)
          .filter(([, i]) => (i.needs === "admin" ? isAdmin(user) : can(user, i.needs)))
          .map(([key, i]) => (
            <Section key={key} title={i.title} template={i.template} file={`${key}-template.csv`} action={importTableAction.bind(null, key)} notes={i.notes} />
          ))}
      </div>
      <section className={card}>
        <h2 className={h2}>Export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download any table as a CSV that opens in Excel. The asset list and custody history also have their own export buttons, which keep your filters.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
          <a href="/assets/export" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
            Assets
          </a>
          <a href="/history/export" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
            Custody history
          </a>
          {Object.entries(EXPORTS).map(([key, t]) => (
            <a key={key} href={`/export/${key}`} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
              {t.label}
            </a>
          ))}
        </div>
      </section>
    </>
  );
}

function Section({
  title,
  template,
  file,
  action,
  notes,
}: {
  title: string;
  template: string;
  file: string;
  action: typeof importAssetsAction;
  notes: string[];
}) {
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className={h2}>{title}</h2>
        <a href={csvHref(template)} download={file} className="text-sm text-primary hover:underline">
          Download template
        </a>
      </div>
      <ul className="my-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <ActionForm action={action} className="space-y-3">
        <input type="file" name="file" accept=".csv,text/csv" required aria-label={`${title} CSV file`} className={input} />
        <button className={btn}>Import</button>
      </ActionForm>
    </section>
  );
}
