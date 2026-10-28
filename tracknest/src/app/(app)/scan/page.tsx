import { requireUser } from "@/lib/auth";
import { h1 } from "@/lib/ui";
import { Scanner } from "./scanner";

export default async function ScanPage() {
  await requireUser();
  return (
    <>
      <h1 className={h1}>Scan a label</h1>
      <Scanner />
    </>
  );
}
