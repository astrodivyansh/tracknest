"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form";

export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  id?: string; // lets a submit button outside the form point at it
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form id={id} action={formAction} className={className}>
      {state?.error && (
        <p role="alert" className="col-span-full whitespace-pre-line rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="col-span-full break-words rounded-md bg-green-50 dark:bg-green-950/40 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          {state.ok}
        </p>
      )}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
