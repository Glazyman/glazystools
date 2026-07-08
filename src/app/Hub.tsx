"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { tools } from "@/lib/tools";

const statusLabel: Record<string, string> = {
  live: "Live",
  wip: "In progress",
  planned: "Planned",
};
const statusDot: Record<string, string> = {
  live: "bg-emerald-500",
  wip: "bg-amber-500",
  planned: "bg-subtle",
};

// The home hub: a searchable launcher for every tool you build.
export function Hub() {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = tools.filter((t) =>
      (t.name + " " + t.tagline + " " + t.category).toLowerCase().includes(q),
    );
    const byCat: Record<string, typeof tools> = {};
    for (const t of matches) (byCat[t.category] ??= []).push(t);
    return byCat;
  }, [query]);

  const categories = Object.keys(grouped);
  const matchCount = categories.reduce((n, c) => n + grouped[c].length, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Glazy&apos;s Tools</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Your hub for everything you build. Search, launch, and keep it all in
          one place.
        </p>
      </div>

      {/* Search + stats */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your tools…"
            className="w-full rounded-xl border border-border bg-panel py-3 pl-10 pr-4 text-sm text-fg shadow-card placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-border bg-panel px-3 py-1.5 shadow-card">
            {tools.length} tool{tools.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-border bg-panel px-3 py-1.5 shadow-card">
            {tools.filter((t) => t.status === "live").length} live
          </span>
        </div>
      </div>

      {/* Tool grid, grouped by category */}
      {matchCount === 0 ? (
        <div className="grid-bg flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-20 text-center shadow-card">
          <p className="text-sm text-muted">
            {tools.length === 0
              ? "No tools yet. Tell Claude what to build first — it'll show up here."
              : `Nothing matches "${query}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {categories.map((cat) => (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">
                {cat}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped[cat].map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    className="group flex flex-col rounded-2xl border border-border bg-panel p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/50"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      {tool.icon ? (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated text-lg">
                          {tool.icon}
                        </span>
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-sm font-semibold text-accent">
                          {tool.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-subtle">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${statusDot[tool.status] ?? "bg-subtle"}`}
                        />
                        {statusLabel[tool.status]}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-fg group-hover:text-accent">
                      {tool.name}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {tool.tagline}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
