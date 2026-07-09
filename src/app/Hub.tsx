"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { tools } from "@/lib/tools";
import { ScrollRestore } from "@/components/workspace/ScrollRestore";

const statusLabel: Record<string, string> = {
  live: "Live",
  wip: "Building",
  planned: "Planned",
};
const statusDot: Record<string, string> = {
  live: "bg-live",
  wip: "bg-wip",
  planned: "bg-planned",
};

// The home hub: a searchable launcher for every tool you build.
export function Hub() {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl-K focuses the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    <div className="grain relative min-h-full overflow-hidden">
      {/* Decorative glows */}
      <div
        className="glow"
        style={{
          width: 520,
          height: 520,
          top: -180,
          right: -120,
          background:
            "radial-gradient(circle, rgba(216,255,62,0.14) 0%, transparent 70%)",
        }}
      />
      <div
        className="glow"
        style={{
          width: 420,
          height: 420,
          top: 120,
          left: -160,
          background:
            "radial-gradient(circle, rgba(255,106,61,0.12) 0%, transparent 70%)",
        }}
      />

      <ScrollRestore />
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-5 py-14 text-center sm:px-8 sm:py-20">
        {/* Eyebrow */}
        <div className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-subtle">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Workspace
          <span className="text-subtle">/</span>
          {tools.length} tool{tools.length === 1 ? "" : "s"}
        </div>

        {/* Hero */}
        <h1 className="mt-6 font-display text-[clamp(3rem,9vw,7rem)] font-normal leading-[0.92] tracking-tight text-fg">
          Tool <em className="italic text-accent">Box</em>
          <span className="text-subtle">.</span>
        </h1>

        {/* Search */}
        <div className="mt-9 w-full max-w-2xl">
          <div className="group flex items-center gap-3 rounded-2xl border border-border bg-panel px-4 py-3.5 shadow-card transition-colors focus-within:border-accent">
            <svg
              className="pointer-events-none shrink-0 text-subtle"
              width="18"
              height="18"
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
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the desk — try 'post' or 'ideas'…"
              className="flex-1 bg-transparent text-base text-fg placeholder:text-subtle focus:outline-none"
            />
            <kbd className="hidden shrink-0 rounded border border-border px-2 py-1 font-mono text-[10px] text-subtle sm:inline">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Tool grid, grouped by category as numbered chapters */}
        <div className="mt-16 w-full text-left">
          {matchCount === 0 ? (
            <div className="grid-bg flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-20 text-center">
              <p className="text-sm text-muted">
                {tools.length === 0
                  ? "No tools yet. Tell Claude what to build first — it'll show up here."
                  : `Nothing matches "${query}".`}
              </p>
            </div>
          ) : (
            <div className="space-y-16">
              {categories.map((cat, ci) => (
                <section key={cat}>
                  <div className="mb-6 flex items-baseline gap-4 border-b border-border pb-4">
                    <span className="font-mono text-xs tracking-widest text-subtle">
                      {String(ci + 1).padStart(2, "0")}
                    </span>
                    <h2 className="font-display text-3xl tracking-tight text-fg sm:text-4xl">
                      {cat}
                    </h2>
                    <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-subtle">
                      {grouped[cat].length} tool
                      {grouped[cat].length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grouped[cat].map((tool) => (
                      <Link
                        key={tool.slug}
                        href={`/tools/${tool.slug}`}
                        className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-panel p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/45 hover:shadow-card"
                      >
                        {/* hover glow */}
                        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_80%_at_50%_-30%,rgba(216,255,62,0.10),transparent_60%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                        <div className="relative mb-4 flex items-center justify-between">
                          {tool.icon ? (
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated text-lg">
                              {tool.icon}
                            </span>
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 font-display text-lg italic text-accent">
                              {tool.name.slice(0, 1)}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-subtle">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${statusDot[tool.status] ?? "bg-planned"}`}
                            />
                            {statusLabel[tool.status] ?? tool.status}
                          </span>
                        </div>

                        <h3 className="relative text-base font-semibold tracking-tight text-fg transition-colors group-hover:text-accent">
                          {tool.name}
                        </h3>
                        <p className="relative mt-1.5 text-sm font-light leading-relaxed text-muted">
                          {tool.tagline}
                        </p>

                        <div className="relative mt-5 flex items-center justify-between border-t border-white/5 pt-4 font-mono text-[11px] text-subtle">
                          <span className="uppercase tracking-wider">
                            {tool.category}
                          </span>
                          <span className="text-accent opacity-0 transition-opacity group-hover:opacity-100">
                            open →
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
