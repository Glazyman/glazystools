# Adding a Tool

Every tool in the workspace follows the same 3-file pattern. This keeps the
sidebar, dashboard, search, and breadcrumbs working automatically — they all
read from the registry.

## 1. Register it — `src/lib/tools.ts`

Add one entry to the `tools` array:

```ts
{
  slug: "word-counter",        // kebab-case, unique — becomes the URL /tools/word-counter
  name: "Word Counter",
  tagline: "Count words, chars, and reading time",   // shown in sidebar + cards
  description: "Paste text and get live word, character, and reading-time stats.",
  icon: "🔤",                  // emoji for now; swap for a real icon later
  category: "Text",            // groups it in the sidebar + /tools page
  status: "wip",               // "live" | "wip" | "planned"
  accent: "sky",
},
```

## 2. Build the page — `src/app/tools/word-counter/page.tsx`

```tsx
import { ToolPage } from "@/components/workspace/ToolPage";

export default function WordCounterPage() {
  return (
    <ToolPage slug="word-counter">
      {/* your tool UI goes here */}
      <p className="text-muted">Coming soon.</p>
    </ToolPage>
  );
}
```

The `slug` must match the registry entry. `<ToolPage>` renders the header
(icon, name, description) and a consistent content container for you.

## 3. (Optional) Add a backend route — `src/app/api/word-counter/route.ts`

Only if the tool calls an AI model or needs server-side work. Keep API keys in
`.env.local`.

```ts
export async function POST(req: Request) {
  const { text } = await req.json();
  // ...call a model, do work...
  return Response.json({ result: "..." });
}
```

## 4. Log it in `BRAIN.md`

Add a dated line noting what the tool does and any decisions made.

---

## Where things go

| Kind of code                     | Location                              |
| -------------------------------- | ------------------------------------- |
| Registry entry                   | `src/lib/tools.ts`                    |
| Tool page                        | `src/app/tools/<slug>/page.tsx`       |
| Tool-only components             | `src/components/tools/<slug>/`        |
| Shared workspace chrome          | `src/components/workspace/`           |
| Backend/API for a tool           | `src/app/api/<slug>/route.ts`         |
| Shared helpers                   | `src/lib/`                            |

## Client vs server

- Default to a **Server Component** (no directive).
- Add `"use client"` at the top only when the file uses `useState`, `useEffect`,
  event handlers, or browser APIs.
- The page shell (`ToolPage`) is a server component; put interactive bits in
  their own `"use client"` child so the page stays mostly server-rendered.
