"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-8 py-16 animate-fade-up">
      <div className="mb-2.5 font-mono text-[13px] font-bold text-[var(--color-accent)]">
        ACCOUNT
      </div>
      <h1 className="font-display text-4xl font-bold tracking-[-0.02em]">
        {title}
      </h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

export function AuthField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        required
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input mt-2"
      />
    </label>
  );
}

const OAUTH_PROVIDERS = [
  { id: "google" as const, label: "Continue with Google" },
  { id: "github" as const, label: "Continue with GitHub" },
];

export function OAuthButtons() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function signIn(provider: "google" | "github") {
    setError(null);
    setPending(provider);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (err) {
      setError(err.message);
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {OAUTH_PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={pending !== null}
          onClick={() => signIn(p.id)}
          className="btn-secondary w-full !py-3.5 !text-[15px]"
        >
          {pending === p.id ? "Redirecting…" : p.label}
        </button>
      ))}
      {error && (
        <p className="text-sm font-semibold text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
