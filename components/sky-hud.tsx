"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, FileText, Shield } from "lucide-react";
import { ScanState, Severity } from "@/types/scan";
import { SEVERITY_COLOR } from "@/components/constellation-graph";

// Overlay drawn on top of the 3D sky: target + status up top, agent stages
// and the live log at the bottom, buttons to get to the details and report.

const STAGE_LABEL: Record<string, string> = {
  planner: "Plan",
  recon: "Recon",
  sqli: "SQLi",
  sql_injection: "SQLi",
  xss: "XSS",
  static: "Static",
  static_analysis: "Static",
  static_c: "C/C++",
  deps_py: "Py deps",
  deps_js: "JS deps",
  dependencies: "Deps",
  secrets: "Secrets",
  attack_chain: "Chain",
  report: "Report",
};

const ALIASES: Record<string, string> = {
  sql_injection: "sqli",
  static_analysis: "static",
  dependencies: "deps_py",
  complete: "report",
};

function norm(key: string) {
  return ALIASES[key] ?? key;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

interface Props {
  scan: ScanState;
  now: number;
  stars: number;
  paths: number;
  chainSource: "agent" | "inferred" | "none";
  onDetails: () => void;
  onReport: () => void;
}

export function SkyHud({ scan, now, stars, paths, chainSource, onDetails, onReport }: Props) {
  const isRunning = scan.status === "running" || scan.status === "pending";
  const elapsed = scan.started_at > 0 ? Math.max(0, Math.floor(now - scan.started_at)) : 0;

  const plan = ["planner", ...scan.agents_plan.map(norm)].filter((k, i, arr) => arr.indexOf(k) === i);
  const current = norm(scan.current_agent);
  const currentIndex = plan.indexOf(current);
  const stageState = (agent: string, i: number) => {
    if (scan.status === "complete") return "done";
    if (scan.status === "failed") return i < currentIndex ? "done" : "queued";
    if (agent === current) return "active";
    if (currentIndex !== -1 && i < currentIndex) return "done";
    return "queued";
  };

  const counts = (["critical", "high", "medium", "low"] as Severity[]).map((s) => ({
    s,
    n: scan.findings.filter((f) => f.severity === s).length,
  }));
  const logTail = scan.log.slice(-3);

  const statusText = isRunning
    ? stars === 0
      ? "Mapping the sky"
      : "Crafting the constellation"
    : scan.status === "failed"
      ? "Scan failed"
      : stars === 0
        ? "Clear skies"
        : "Constellation complete";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex min-w-0 items-start gap-3">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur transition-colors hover:border-cyan-300/35"
          >
            <span className="rounded-full border border-white/10 bg-white/8 p-1 text-cyan-200">
              <Shield className="h-3.5 w-3.5" />
            </span>
            <span className="font-serif text-xl leading-none tracking-tight text-white">Orion</span>
          </Link>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 backdrop-blur">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "animate-pulse bg-cyan-300" : scan.status === "failed" ? "bg-red-400" : "bg-emerald-300"}`} />
              {statusText}
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{formatDuration(elapsed)}</span>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-slate-100 md:text-sm">{scan.target}</p>
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3.5 py-2 text-xs font-semibold text-slate-100 backdrop-blur transition-colors hover:border-white/30 hover:bg-white/10"
          >
            Details
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onReport}
            disabled={scan.status !== "complete"}
            title={scan.status === "complete" ? "Open the full report" : "Report unlocks when the scan completes"}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-40"
          >
            <FileText className="h-3.5 w-3.5" />
            Report
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="pointer-events-auto flex max-w-xl flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {plan.map((agent, i) => {
              const st = stageState(agent, i);
              return (
                <span
                  key={agent}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur ${
                    st === "active"
                      ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                      : st === "done"
                        ? "border-emerald-300/25 bg-black/40 text-emerald-200/90"
                        : "border-white/10 bg-black/30 text-slate-500"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${st === "active" ? "animate-pulse bg-cyan-300" : st === "done" ? "bg-emerald-300" : "bg-slate-600"}`} />
                  {STAGE_LABEL[agent] ?? agent}
                </span>
              );
            })}
          </div>
          {logTail.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300/80 backdrop-blur">
              {logTail.map((line, i) => (
                <p key={`${i}-${line.slice(0, 24)}`} className={`truncate ${i === logTail.length - 1 ? "text-slate-100" : "text-slate-400/70"}`}>
                  <span className="text-cyan-300/70">›</span> {line}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="pointer-events-auto mb-14 flex flex-col items-start gap-2 md:mb-0 md:mr-40 md:items-end">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-3.5 py-2 font-mono text-[11px] text-slate-200 backdrop-blur">
            <span>
              {stars} {stars === 1 ? "star" : "stars"}
            </span>
            <span className="text-slate-600">·</span>
            <span>
              {paths} attack {paths === 1 ? "path" : "paths"}
            </span>
            {counts.some((c) => c.n > 0) && <span className="text-slate-600">·</span>}
            {counts
              .filter((c) => c.n > 0)
              .map((c) => (
                <span key={c.s} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLOR[c.s], boxShadow: `0 0 8px ${SEVERITY_COLOR[c.s]}` }} />
                  {c.n}
                </span>
              ))}
          </div>
          <p className="font-mono text-[10px] text-slate-400/80">
            {chainSource === "inferred" ? "Paths inferred from findings. " : ""}
            Drag to orbit. Scroll to zoom. Click a star for the fix.
          </p>
        </div>
      </div>
    </div>
  );
}
