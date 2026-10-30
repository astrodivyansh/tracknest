import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { GoogleButton } from "@/components/google-button";
import { googleEnabled } from "@/lib/google";
import { btn, card, input, label } from "@/lib/ui";
import { login } from "../actions";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <div className={card}>
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      {typeof error === "string" && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {googleEnabled() && (
        <div className="mb-4 space-y-4">
          <GoogleButton label="Continue with Google" />
          <p className="text-center text-xs text-muted-foreground">or sign in with your password</p>
        </div>
      )}
      <ActionForm action={login} className="space-y-4">
        <label className={label}>
          Email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className={label}>
          Password
          <input name="password" type="password" required autoComplete="current-password" className={input} />
        </label>
        <label className={label}>
          <span>
            Authenticator code <span className="font-normal text-muted-foreground">(only if two-step sign-in is on)</span>
          </span>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} className={input} />
        </label>
        <button className={`${btn} w-full`}>Sign in</button>
        <p className="text-right text-sm">
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password?
          </Link>
        </p>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="font-medium text-primary">
          Create your organization
        </Link>
      </p>
    </div>
  );
}
