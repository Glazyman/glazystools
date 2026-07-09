"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { tools, toolsByCategory } from "@/lib/tools";

const statusDot: Record<string, string> = {
  live: "bg-live",
  wip: "bg-wip",
  planned: "bg-planned",
};

function Hamburger() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

// The single unified sidebar. Expanded: wordmark + search + tool list.
// Collapsed (desktop): a slim icon rail showing each tool's emoji.
// The hamburger toggle sits at the same top-left spot in both states.
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const byCat = toolsByCategory();
  const onHub = pathname === "/";

  const toggleBtn = onToggle && (
    <button
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <Hamburger />
    </button>
  );

  /* ── Collapsed icon rail (desktop only) ───────────────────────── */
  if (collapsed) {
    return (
      <aside className="hidden h-full w-16 shrink-0 flex-col border-r border-border bg-bg py-3 md:flex">
        <div className="px-3">{toggleBtn}</div>
        <div className="mx-auto my-2.5 h-px w-6 bg-border" />
        <nav className="flex flex-col items-center gap-1.5">
          <Link
            href="/"
            title="Hub"
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors ${
              onHub
                ? "bg-hover text-accent"
                : "text-subtle hover:bg-hover hover:text-fg"
            }`}
          >
            🧰
          </Link>
          <div className="my-1 h-px w-6 bg-border" />
          {tools.map((tool) => {
            const href = `/tools/${tool.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={tool.slug}
                href={href}
                title={tool.name}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors ${
                  active
                    ? "bg-hover text-fg ring-1 ring-accent/40"
                    : "text-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {tool.icon || tool.name.slice(0, 1)}
                <span
                  className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ring-2 ring-bg ${
                    statusDot[tool.status] ?? "bg-planned"
                  }`}
                />
              </Link>
            );
          })}
        </nav>
      </aside>
    );
  }

  /* ── Expanded panel ───────────────────────────────────────────── */
  const filtered = (name: string, tagline: string) =>
    (name + tagline).toLowerCase().includes(query.toLowerCase());

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-panel">
      {/* Toggle + wordmark (top-left) */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-3">
        {toggleBtn}
        <Link
          href="/"
          className="font-display text-[15px] font-semibold tracking-tight text-fg transition-colors hover:text-accent"
        >
          Glazy&apos;s Tools
        </Link>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools…"
          className="w-full rounded-lg border border-border bg-elevated px-3 py-2.5 text-base text-fg placeholder:text-subtle focus:border-accent focus:outline-none sm:py-2 sm:text-xs"
        />
      </div>

      {/* Hub link */}
      <div className="px-2">
        <Link
          href="/"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors ${
            onHub ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg"
          }`}
        >
          <span className="text-base leading-none">🧰</span>
          <span className="flex-1">Hub</span>
        </Link>
      </div>

      {/* Tool tree */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {tools.length === 0 && (
          <p className="px-2 py-6 text-xs leading-relaxed text-subtle">
            No tools yet. Tell Claude which tool to build first and it&apos;ll
            appear here.
          </p>
        )}

        {Object.entries(byCat).map(([cat, items]) => {
          const visible = items.filter((t) => filtered(t.name, t.tagline));
          if (visible.length === 0) return null;
          return (
            <div key={cat} className="mb-3">
              <div className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                {cat}
              </div>
              {visible.map((tool) => {
                const href = `/tools/${tool.slug}`;
                const active = pathname === href;
                return (
                  <Link
                    key={tool.slug}
                    href={href}
                    className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-hover text-fg"
                        : "text-muted hover:bg-hover hover:text-fg"
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elevated text-sm leading-none">
                      {tool.icon || tool.name.slice(0, 1)}
                    </span>
                    <span className="flex-1 truncate">{tool.name}</span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        statusDot[tool.status] ?? "bg-planned"
                      }`}
                      title={tool.status}
                    />
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
