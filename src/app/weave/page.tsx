import { Weave } from "@/app/tools/weave/Weave";

export const metadata = { title: "Weave" };

/**
 * Weave with no workspace around it — no sidebar, no breadcrumb, no header.
 * Just the board, edge to edge.
 *
 * This is what the Weave Bar menu-bar app loads. In a 1400px window the
 * workspace chrome is pure overhead: you already know which tool you opened,
 * because you opened its app.
 *
 * `/tools/weave` still exists and still has the full workspace — same
 * component, same boards, same Supabase rows. This is a second door into it,
 * not a copy.
 */
export default function WeaveBarePage() {
  return (
    <div className="h-dvh w-full overflow-hidden">
      <Weave />
    </div>
  );
}
