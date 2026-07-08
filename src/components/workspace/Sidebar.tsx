"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { tools, toolsByCategory } from "@/lib/tools";

const statusDot: Record<string, string> = {
  live: "bg-emerald-400",
  wip: "bg-amber-400",
  planned: "bg-subtle",
};

export function Sidebar({ onCollapse }: { onCollapse?: () => void }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const byCat = toolsByCategory();

  const filtered = (name: string, tagline: string) =>
    (name + tagline).toLowerCase().includes(query.toLowerCase());

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-panel">
      {/* Explorer header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          Tools
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
            {tools.length}
          </span>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="hidden h-6 w-6 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg md:flex"
            >
              «
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools…"
          className="w-full rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </div>

      {/* Tool tree */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {tools.length === 0 && (
          <p className="px-2 py-6 text-xs leading-relaxed text-subtle">
            No tools yet. This is your workspace shell — tell Claude which tool
            to build first and it&apos;ll appear here.
          </p>
        )}

        {Object.entries(byCat).map(([cat, items]) => {
          const visible = items.filter((t) => filtered(t.name, t.tagline));
          if (visible.length === 0) return null;
          return (
            <div key={cat} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-subtle">
                {cat}
              </div>
              {visible.map((tool) => {
                const href = `/tools/${tool.slug}`;
                const active = pathname === href;
                return (
                  <Link
                    key={tool.slug}
                    href={href}
                    className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-hover text-fg"
                        : "text-muted hover:bg-hover hover:text-fg"
                    }`}
                  >
                    <span className="text-base leading-none">{tool.icon}</span>
                    <span className="flex-1 truncate">{tool.name}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        statusDot[tool.status] ?? "bg-subtle"
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
