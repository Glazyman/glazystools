"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Wrong password.");
      }
      // Go where they were headed (defaults to the hub).
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6 shadow-card"
      >
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-lg font-bold text-bg">
            G
          </span>
          <div>
            <h1 className="text-base font-semibold text-fg">Glazy&apos;s Tools</h1>
            <p className="text-xs text-muted">Enter the password to continue</p>
          </div>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
        />

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
