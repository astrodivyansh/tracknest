import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { btn, card, input, label } from "@/lib/ui";
import { login } from "../actions";

export default function LoginPage() {
  return (
    <div className={card}>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      <ActionForm action={login} className="space-y-4">
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className={label}>
          Password
          <input name="password" type="password" required autoComplete="current-password" className={input} />
        </label>
        <button className={`${btn} w-full`}>Sign in</button>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-gray-600">
        New here?{" "}
        <Link href="/signup" className="font-medium text-indigo-600">
          Create your organization
        </Link>
      </p>
    </div>
  );
}
