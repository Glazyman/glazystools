import Link from "next/link";
import { tools } from "@/lib/tools";

const statusLabel: Record<string, string> = {
  live: "Live",
  wip: "In progress",
  planned: "Planned",
};

export default function Dashboard() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          Glazy&apos;s Tools
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Your workspace for building AI-powered tools. Each tool lives on its
          own page and shows up in the sidebar. Pick one below, or tell Claude
          what to build next.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-10 grid grid-cols-3 gap-3">
        <Stat label="Tools" value={tools.length} />
        <Stat
          label="Live"
          value={tools.filter((t) => t.status === "live").length}
        />
        <Stat
          label="In progress"
          value={tools.filter((t) => t.status === "wip").length}
        />
      </div>

      {/* Tool grid or empty state */}
      {tools.length === 0 ? (
        <div className="grid-bg flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-2xl">
            🛠️
          </div>
          <h2 className="text-base font-medium">No tools yet</h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            This is the empty workspace. Tell Claude which tool you want first —
            it&apos;ll scaffold the page, register it, and it&apos;ll appear
            right here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.slug}
              href={`/tools/${tool.slug}`}
              className="group rounded-xl border border-border bg-panel p-5 transition-colors hover:border-border-strong hover:bg-elevated"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated text-lg">
                  {tool.icon}
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-subtle">
                  {statusLabel[tool.status]}
                </span>
              </div>
              <h3 className="text-sm font-medium text-fg">{tool.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {tool.tagline}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-panel px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
