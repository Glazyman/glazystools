"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard", icon: "◱" },
  { href: "/tools", label: "All Tools", icon: "▦" },
];

export function ActivityBar() {
  const pathname = usePathname();
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg py-3">
      <Link
        href="/"
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-strong text-sm font-bold text-bg"
        title="Glazy's Tools"
      >
        G
      </Link>
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-lg transition-colors ${
              active
                ? "bg-hover text-accent"
                : "text-subtle hover:bg-hover hover:text-fg"
            }`}
          >
            {item.icon}
          </Link>
        );
      })}
    </div>
  );
}
