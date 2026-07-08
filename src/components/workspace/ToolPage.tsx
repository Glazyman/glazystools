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
          <div className="flex min-w-0 items-start gap-3">
            {tool.icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-xl sm:h-11 sm:w-11 sm:text-2xl">
                {tool.icon}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">
                {tool.name}
              </h1>
              {/* Description as a small dropdown to keep the header tidy. */}
              <details className="group mt-0.5">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted hover:text-fg">
                  About
                  <span className="transition-transform group-open:rotate-180">
                    ⌄
                  </span>
                </summary>
                <p className="mt-1.5 max-w-xl text-sm text-muted">
                  {tool.description}
                </p>
              </details>
            </div>
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
