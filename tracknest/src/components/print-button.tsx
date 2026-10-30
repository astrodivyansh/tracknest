"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (also "Save as PDF"). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer /> Print / PDF
    </Button>
  );
}
