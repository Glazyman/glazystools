"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ActivityBar() {
  const pathname = usePathname();
  const onHub = pathname === "/";
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg py-3">
      <Link
        href="/"
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-strong text-sm font-bold text-bg"
        title="Glazy's Tools"
      >
        G
      </Link>
      <Link
        href="/"
        title="Hub"
        className={`flex h-9 w-9 items-center justify-center rounded-md text-lg transition-colors ${
          onHub
            ? "bg-hover text-accent"
            : "text-subtle hover:bg-hover hover:text-fg"
        }`}
      >
        ▦
      </Link>
    </div>
  );
}
