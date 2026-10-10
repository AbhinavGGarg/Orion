"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";

export function SiteHeader() {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/scan/")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070d18]/85 backdrop-blur-xl">
      <div className="page-shell">
        <div className="page-container flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 transition-all hover:border-cyan-300/35 hover:bg-cyan-300/10"
          >
            <span className="rounded-full border border-white/10 bg-white/8 p-1 text-cyan-200">
              <Shield className="h-3.5 w-3.5" />
            </span>
            <span className="font-serif text-2xl leading-none tracking-tight text-white">Polaris</span>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300 transition-colors hover:text-cyan-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            New Target
          </Link>
        </div>
      </div>
    </header>
  );
}
