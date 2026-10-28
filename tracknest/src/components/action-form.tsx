"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/form";

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {state?.error && (
        <p role="alert" className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="col-span-full rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.ok}
        </p>
      )}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
