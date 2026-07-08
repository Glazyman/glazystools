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

export function TopBar() {
  const pathname = usePathname();
  const parts = crumbs(pathname);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-bg px-4">
      <div className="flex items-center gap-2 text-sm">
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
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          local
        </span>
      </div>
    </header>
  );
}
