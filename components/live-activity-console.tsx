"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Bot,
  Compass,
  Cpu,
  Radar,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ActivityKind =
  | "planner"
  | "tool"
  | "discovery"
  | "warning"
  | "synthesis"
  | "system";

interface ParsedEntry {
  kind: ActivityKind;
  text: string;
  index: number;
}

interface LiveActivityConsoleProps {
  entries: string[];
  title?: string;
  streaming?: boolean;
  emptyLabel?: string;
  className?: string;
}

const KIND_META: Record<
  ActivityKind,
  {
    label: string;
    className: string;
    icon: typeof Compass;
  }
> = {
  planner: {
    label: "planner",
    className: "text-cyan-300 border-cyan-300/35 bg-cyan-300/10",
    icon: Compass,
  },
  tool: {
    label: "tool",
    className: "text-blue-300 border-blue-300/35 bg-blue-300/10",
    icon: Cpu,
  },
  discovery: {
    label: "discovery",
    className: "text-emerald-300 border-emerald-300/35 bg-emerald-300/10",
    icon: Radar,
  },
  warning: {
    label: "warning",
    className: "text-amber-300 border-amber-300/35 bg-amber-300/10",
    icon: AlertTriangle,
  },
  synthesis: {
    label: "synthesis",
    className: "text-violet-300 border-violet-300/35 bg-violet-300/10",
    icon: Sparkles,
  },
  system: {
    label: "system",
    className: "text-slate-300 border-slate-300/30 bg-white/8",
    icon: Bot,
  },
};

function detectKind(entry: string): ActivityKind {
  const value = entry.toLowerCase();

  if (value.includes("[skip]") || /warn|timeout|fail|error|blocked/.test(value)) {
    return "warning";
  }

  if (/planner|plan|fingerprint|architecture/.test(value)) {
    return "planner";
  }

  if (/attack chain|mitre|report|synthesis|llm/.test(value)) {
    return "synthesis";
  }

  if (/found|discover|vulnerab|critical|high severity|exposed/.test(value)) {
    return "discovery";
  }

  if (/scan|running|httpx|sqlmap|dalfox|nmap|semgrep|bandit|audit|trufflehog/.test(value)) {
    return "tool";
  }

  return "system";
}

export function LiveActivityConsole({
  entries,
  title = "Live Activity",
  streaming = false,
  emptyLabel = "Awaiting activity stream",
  className,
}: LiveActivityConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo<ParsedEntry[]>(
    () => entries.map((entry, index) => ({ index, text: entry, kind: detectKind(entry) })),
    [entries],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [parsed.length]);

  return (
    <section className={cn("surface-panel-muted flex h-full min-h-[22rem] flex-col", className)}>
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="status-dot bg-cyan-300" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-cyan-200/80">
            {title}
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-mono text-slate-300">
          {parsed.length} events
        </span>
      </header>

      {parsed.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <div className="h-2.5 w-28 rounded-full scan-shimmer" />
          <p className="text-sm text-slate-400">{emptyLabel}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {parsed.map((entry) => {
            const meta = KIND_META[entry.kind];
            const Icon = meta.icon;
            return (
              <article
                key={`${entry.index}-${entry.text}`}
                className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest",
                      meta.className,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    #{String(entry.index + 1).padStart(3, "0")}
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed text-slate-200/90">
                  {entry.text}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {streaming && parsed.length > 0 ? (
        <footer className="flex items-center gap-2 border-t border-white/10 px-4 py-2 text-[11px] font-mono text-emerald-300/80">
          <span className="status-dot animate-pulse bg-emerald-300" />
          Stream active
        </footer>
      ) : null}
    </section>
  );
}
