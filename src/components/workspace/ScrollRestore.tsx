"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Remembers the scroll position of its nearest scrollable ancestor (per route)
// and restores it after a reload, so you come back exactly where you left off.
export function ScrollRestore() {
  const anchor = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    // Walk up to the nearest scroll container (by CSS overflow) — content may
    // not have painted tall yet, so don't gate on current scrollability.
    let el = anchor.current?.parentElement as HTMLElement | null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      el = el.parentElement;
    }
    if (!el) return;
    const scroller = el;
    const key = `scroll:${pathname}`;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Restore — retried because content (e.g. a restored run) can paint
    // slightly after mount, changing the scroll height. While restoring we
    // suppress saving so intermediate/layout-shift scrolls don't clobber it.
    const target = Number(sessionStorage.getItem(key) ?? "0");
    let restoring = target > 0;
    if (restoring) {
      const apply = () => {
        scroller.scrollTop = target;
      };
      apply();
      requestAnimationFrame(apply);
      [80, 250, 500, 850].forEach((ms) => timers.push(setTimeout(apply, ms)));
      timers.push(
        setTimeout(() => {
          restoring = false;
        }, 1000),
      );
    }

    const save = () => {
      if (restoring) return;
      try {
        sessionStorage.setItem(key, String(scroller.scrollTop));
      } catch {
        /* ignore */
      }
    };
    let last = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - last > 100) {
        last = now;
        save();
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // Also capture the exact final position when leaving/hiding the page.
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
      timers.forEach(clearTimeout);
    };
  }, [pathname]);

  return <div ref={anchor} aria-hidden className="hidden" />;
}
