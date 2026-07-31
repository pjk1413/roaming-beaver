"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthField, AuthShell, OAuthButtons } from "@/components/auth-form";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data.session) {
      setCheckEmail(true);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  if (checkEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}.`}
      >
        <Link href="/login" className="font-semibold underline">
          Back to log in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign up" subtitle="Save your trips.">
      <OAuthButtons />
      <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
        or email
        <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField label="Name" value={name} onChange={setName} />
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
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-[var(--color-ink)] underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
