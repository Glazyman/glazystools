import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTool } from "@/lib/tools";

// Wraps an individual tool's UI with a consistent header (icon, name,
// description, status). Every tool page renders <ToolPage slug="...">.
export function ToolPage({
  slug,
  children,
  actions,
}: {
  slug: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const tool = getTool(slug);
  if (!tool) notFound();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {tool.icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-xl sm:h-11 sm:w-11 sm:text-2xl">
                {tool.icon}
              </span>
            )}
            {/* Name row is a dropdown — chevron on the far right reveals the
                description, matching the other cards. */}
            <details className="group min-w-0 flex-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  {tool.name}
                </h1>
                <span className="text-subtle transition-transform group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <p className="mt-1.5 max-w-xl text-sm text-muted">
                {tool.description}
              </p>
            </details>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}
