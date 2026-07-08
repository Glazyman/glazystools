import { ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// The persistent IDE chrome that wraps every page:
// [ activity bar | sidebar | ( top bar / content ) ]
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <ActivityBar />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
