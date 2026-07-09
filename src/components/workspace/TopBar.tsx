"use client";

import { usePathname } from "next/navigation";
import { getTool } from "@/lib/tools";

function crumbs(pathname: string) {
  if (pathname === "/") return ["Hub"];
  if (pathname === "/tools") return ["Hub"];
  const m = pathname.match(/^\/tools\/([^/]+)/);
  if (m) {
    const tool = getTool(m[1]);
    return ["Tools", tool?.name ?? m[1]];
  }
  return [pathname];
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const parts = crumbs(pathname);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-border bg-bg px-2 sm:h-12 sm:px-5">
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        {/* Hamburger — mobile only (desktop toggle lives in the sidebar) */}
        <button
          aria-label="Open menu"
          onClick={onMenu}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg transition-colors hover:bg-hover active:bg-hover md:hidden"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {parts.map((p, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span className="text-subtle">/</span>}
            <span
              className={`truncate font-mono text-[13px] uppercase tracking-wider sm:text-xs ${
                i === parts.length - 1 ? "text-fg" : "hidden text-muted sm:inline"
              }`}
            >
              {p}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-subtle">
        <span className="hidden sm:inline">Glazy&apos;s Tools</span>
      </div>
    </header>
  );
}
