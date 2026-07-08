import Link from "next/link";
import { toolsByCategory, tools } from "@/lib/tools";

export const metadata = { title: "All Tools · Glazy's Tools" };

export default function AllTools() {
  const byCat = toolsByCategory();

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-xl font-semibold tracking-tight">All Tools</h1>
      <p className="mt-1.5 text-sm text-muted">
        Everything in the workspace, grouped by category.
      </p>

      {tools.length === 0 ? (
        <p className="mt-8 text-sm text-subtle">
          No tools registered yet.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {Object.entries(byCat).map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">
                {cat}
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 transition-colors hover:border-border-strong hover:bg-elevated"
                  >
                    <span className="text-lg">{tool.icon}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {tool.name}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {tool.tagline}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
