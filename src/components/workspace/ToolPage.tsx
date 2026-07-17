import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTool } from "@/lib/tools";
import { ScrollRestore } from "./ScrollRestore";

// Wraps an individual tool's UI with a consistent header (icon, name,
// description, status). Every tool page renders <ToolPage slug="...">.
export function ToolPage({
  slug,
  children,
  actions,
  bleed = false,
  hideHeader = false,
}: {
  slug: string;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * Hand the tool the full content area: no max-width, no padding, no page
   * scroll. For tools that own their own viewport (canvases, maps, editors)
   * where the centred scrolling column would be actively wrong.
   */
  bleed?: boolean;
  /**
   * Drop the name/description header entirely. For immersive tools that carry
   * their own chrome and want every pixel — the breadcrumb in the top bar
   * already says where you are, so the heading is just a second label.
   */
  hideHeader?: boolean;
}) {
  const tool = getTool(slug);
  if (!tool) notFound();

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
      <div className="border-b border-border px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex w-full min-w-0 flex-1 items-start gap-3">
            {/* Name row is a dropdown — chevron on the far right reveals the
                description, matching the other cards. Text only (no icon). */}
            <details className="group w-full min-w-0 flex-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  {tool.name}
                </h1>
                <span className="chevron text-subtle">⌄</span>
              </summary>
              <p className="mt-1.5 max-w-xl text-sm text-muted">
                {tool.description}
              </p>
            </details>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      )}
      {bleed ? (
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ScrollRestore />
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
