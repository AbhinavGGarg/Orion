"use client";

import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { Finding, Severity } from "@/types/scan";

const SEVERITY_STYLES: Record<
  Severity,
  {
    badge: string;
    border: string;
    accent: string;
  }
> = {
  critical: {
    badge: "bg-red-500/20 text-red-200 border-red-400/40",
    border: "border-red-400/30 hover:border-red-300/55",
    accent: "text-red-200",
  },
  high: {
    badge: "bg-orange-500/20 text-orange-200 border-orange-400/40",
    border: "border-orange-400/30 hover:border-orange-300/55",
    accent: "text-orange-200",
  },
  medium: {
    badge: "bg-amber-500/20 text-amber-200 border-amber-400/40",
    border: "border-amber-400/30 hover:border-amber-300/55",
    accent: "text-amber-200",
  },
  low: {
    badge: "bg-blue-500/20 text-blue-200 border-blue-400/40",
    border: "border-blue-400/30 hover:border-blue-300/55",
    accent: "text-blue-200",
  },
  info: {
    badge: "bg-slate-500/20 text-slate-200 border-slate-300/35",
    border: "border-slate-300/20 hover:border-slate-200/45",
    accent: "text-slate-200",
  },
};

interface Props {
  finding: Finding;
  index: number;
  onClick: (finding: Finding) => void;
}

function shortText(value: string, fallback: string): string {
  const text = value.trim();
  if (!text) return fallback;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function FindingCard({ finding, index, onClick }: Props) {
  const styles = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info;
  const affected = finding.component?.trim() || "Target surface";
  const remediation = shortText(finding.remediation, "Review input validation, authentication checks, and dependency patch levels.");

  return (
    <button
      onClick={() => onClick(finding)}
      className={`w-full cursor-pointer rounded-xl border bg-[#0b1222]/80 p-4 text-left transition-all ${styles.border}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${styles.badge}`}>
            {finding.severity}
          </span>
          <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[10px] font-mono text-slate-300">
            {finding.tool || "scanner"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
          <span>#{index + 1}</span>
          <ArrowUpRight className="h-3 w-3" />
        </div>
      </div>

      <h3 className="text-sm font-semibold leading-snug text-slate-100">{finding.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-300/85">{shortText(finding.description, "No description provided")}</p>

      <div className="mt-3 grid gap-2 text-[11px] text-slate-300/80">
        <p className="flex items-center gap-2">
          <ShieldAlert className={`h-3.5 w-3.5 ${styles.accent}`} />
          <span className="font-medium text-slate-100">Affected:</span>
          <span className="truncate">{affected}</span>
        </p>
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 leading-relaxed text-slate-300/80">
          <span className="mr-1 font-medium text-slate-100">Recommendation:</span>
          {remediation}
        </p>
      </div>
    </button>
  );
}
