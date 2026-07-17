"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// The persistent IDE chrome that wraps every page.
// Desktop: [ activity bar | sidebar | ( top bar / content ) ]
// Mobile:  full-width content with a hamburger that opens the chrome as a drawer.
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop sidebar
  const pathname = usePathname();

  // Restore the collapsed state from a previous session.
  useEffect(() => {
    setCollapsed(localStorage.getItem("sidebar:collapsed") === "1");
  }, []);
  // Persist it so a reload keeps the sidebar the way you left it.
  useEffect(() => {
    localStorage.setItem("sidebar:collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);

  // Standalone routes get no chrome at all: the login page, and the bare
  // single-tool routes the desktop apps load (/weave), where a sidebar full of
  // other tools would be noise inside an app that IS one tool.
  if (pathname === "/login" || pathname === "/weave") return <>{children}</>;

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* Desktop: one unified sidebar — expanded panel or slim icon rail. */}
      <div className="hidden md:flex">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>

      {/* Mobile drawer — always the expanded sidebar; toggle closes it. */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute left-0 top-0 flex h-full">
            <Sidebar onToggle={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
