"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// The persistent IDE chrome that wraps every page.
// Desktop: [ activity bar | sidebar | ( top bar / content ) ]
// Mobile:  full-width content with a hamburger that opens the chrome as a drawer.
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop sidebar
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* Desktop chrome — hidden on small screens; sidebar can be collapsed */}
      <div className="hidden md:flex">
        <ActivityBar />
        {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}
      </div>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute left-0 top-0 flex h-full">
            <ActivityBar />
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenu={() => setNavOpen(true)}
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
