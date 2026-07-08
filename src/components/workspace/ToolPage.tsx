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
      <div className="border-b border-border px-8 py-5">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-elevated text-2xl">
              {tool.icon}
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {tool.name}
              </h1>
              <p className="mt-0.5 max-w-xl text-sm text-muted">
                {tool.description}
              </p>
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
      </div>
    </div>
  );
}
