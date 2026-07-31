"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthField, AuthShell, OAuthButtons } from "@/components/auth-form";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <AuthShell title="Log in" subtitle="Welcome back.">
      <OAuthButtons />
      <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
        or email
        <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField label="Email" type="email" value={email} onChange={setEmail} />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
        />
        {error && (
          <p className="text-sm font-semibold text-[var(--color-danger)]">{error}</p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? "Signing in…" : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-[var(--color-ink)] underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
