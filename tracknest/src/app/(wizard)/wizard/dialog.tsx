"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { ActionForm } from "@/components/action-form";
import type { FormState } from "@/lib/form";
import { btn, btnSecondary } from "@/lib/ui";

/** A button that opens a form in a modal, closing once the form saves. */
export function FormDialog({
  title,
  intro,
  trigger,
  triggerClass,
  submit,
  action,
  children,
}: {
  title: string;
  intro?: string;
  trigger: React.ReactNode;
  triggerClass?: string;
  submit: string;
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const save = async (state: FormState, data: FormData) => {
    const result = await action(state, data);
    if (result?.ok) setOpen(false);
    return result;
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={triggerClass ?? btn}>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90svh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <ActionForm action={save} className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
            {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
            {children}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button className={btn}>{submit}</button>
              <Dialog.Close type="button" className={btnSecondary}>
                Cancel
              </Dialog.Close>
            </div>
          </ActionForm>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
