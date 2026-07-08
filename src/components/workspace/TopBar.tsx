"use client";

import { usePathname } from "next/navigation";
import { getTool } from "@/lib/tools";

function crumbs(pathname: string) {
  if (pathname === "/") return ["Dashboard"];
  if (pathname === "/tools") return ["All Tools"];
  const m = pathname.match(/^\/tools\/([^/]+)/);
  if (m) {
    const tool = getTool(m[1]);
    return ["Tools", tool?.name ?? m[1]];
  }
  return [pathname];
}

export function TopBar({
  onMenu,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  onMenu?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const pathname = usePathname();
  const parts = crumbs(pathname);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-bg px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {/* Hamburger — mobile only */}
        <button
          aria-label="Open menu"
          onClick={onMenu}
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Sidebar toggle — desktop only */}
        {onToggleSidebar && (
          <button
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={onToggleSidebar}
            className="-ml-1 hidden h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg md:flex"
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        )}
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-subtle">/</span>}
            <span className={i === parts.length - 1 ? "text-fg" : "text-muted"}>
              {p}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-subtle">
        <span className="hidden sm:inline">Glazy&apos;s Tools</span>
      </div>
    </header>
  );
}
