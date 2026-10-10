"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Bot,
  Database,
  FileText,
  GitBranch,
  Radar,
  ShieldAlert,
} from "lucide-react";
import { PlatformShell } from "@/components/platform-shell";
import { ScanForm } from "@/components/scan-form";
import { Starfield } from "@/components/starfield";
import { apiUrl } from "@/lib/api";
import { ScanState } from "@/types/scan";

type StageStatus = "ready" | "running" | "queued" | "complete" | "failed";
type StageKey = "planner" | "recon" | "static" | "dependencies" | "secrets" | "report";

const PIPELINE_STAGES: Array<{ key: StageKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "planner", label: "Planner", icon: Bot },
  { key: "recon", label: "Recon", icon: Radar },
  { key: "static", label: "Static", icon: GitBranch },
  { key: "dependencies", label: "Dependencies", icon: Database },
  { key: "secrets", label: "Secrets", icon: ShieldAlert },
  { key: "report", label: "Report", icon: FileText },
] as const;

const STAGE_OVERVIEW: Record<StageKey, string> = {
  planner: "Profiles the target and builds the ordered scan plan.",
  recon: "Collects network and web intelligence (HTTP, ports, fingerprinting).",
  static: "Runs deeper detection checks (static patterns, SQLi, and XSS probes).",
  dependencies: "Analyzes dependency risk and attack-chain relationships.",
  secrets: "Scans for exposed credentials and secret material.",
  report: "Compiles final findings and remediation into the report.",
};

const STAGE_LOG_HINTS: Record<StageKey, string[]> = {
  planner: ["plan", "architect", "fingerprint", "analysing"],
  recon: ["recon", "httpx", "nmap", "whatweb"],
  static: ["static", "sqli", "sql", "xss", "semgrep", "bandit", "cppcheck"],
  dependencies: ["dependenc", "attack chain", "deps", "pip-audit", "npm"],
  secrets: ["secret", "trufflehog", "detect-secrets"],
  report: ["report", "generation", "complete"],
};

function stageFromAgent(agent: string): StageKey | null {
  if (agent === "planner") return "planner";
  if (agent === "recon") return "recon";
  if (agent === "static" || agent === "static_c" || agent === "sql_injection" || agent === "xss") return "static";
  if (agent === "deps" || agent === "deps_py" || agent === "deps_js" || agent === "dependencies") return "dependencies";
  if (agent === "attack_chain") return "dependencies";
  if (agent === "secrets") return "secrets";
  if (agent === "report" || agent === "complete") return "report";
  return null;
}

function statusClass(status: StageStatus) {
  const map = {
    ready: "text-emerald-200 border-emerald-300/35 bg-emerald-300/12",
    running: "text-cyan-100 border-cyan-300/35 bg-cyan-300/12",
    queued: "text-slate-200 border-slate-300/25 bg-white/8",
    complete: "text-emerald-100 border-emerald-300/45 bg-emerald-300/18",
    failed: "text-red-200 border-red-300/45 bg-red-300/12",
  } as const;
  return map[status];
}

function stageCardClass(status: StageStatus): string {
  if (status === "complete") {
    return "border-emerald-300/45 bg-emerald-400/16 shadow-[0_0_0_1px_rgba(16,185,129,0.22)_inset]";
  }
  if (status === "running") {
    return "border-cyan-300/40 bg-cyan-400/10";
  }
  if (status === "failed") {
    return "border-red-300/45 bg-red-400/10";
  }
  return "border-white/10 bg-[#0d1322]/70";
}

const HEADLINE_WORDS = ["Every", "vulnerability", "is", "a", "star."];

function AuroraBlob({ className, delay, reduce }: { className: string; delay: number; reduce: boolean }) {
  return (
    <motion.div
      aria-hidden
      className={`absolute rounded-full blur-3xl ${className}`}
      animate={reduce ? undefined : { x: [0, 28, -18, 0], y: [0, -22, 18, 0], scale: [1, 1.12, 0.94, 1] }}
      transition={reduce ? undefined : { duration: 20, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function KineticHeadline({ reduce }: { reduce: boolean }) {
  return (
    <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white md:text-6xl">
      {HEADLINE_WORDS.map((word, i) => (
        <motion.span
          key={word}
          className="mr-[0.25em] inline-block"
          initial={reduce ? false : { opacity: 0, y: "0.5em", rotateX: -45 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ delay: 0.2 + i * 0.1, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          {word}
        </motion.span>
      ))}
    </h1>
  );
}

function Typewriter({ text, reduce }: { text: string; reduce: boolean }) {
  const [shown, setShown] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) window.clearInterval(id);
    }, 55);
    return () => window.clearInterval(id);
  }, [text, reduce]);
  return (
    <span className="text-cyan-100/90">
      {text.slice(0, shown)}
      <span className="ml-0.5 inline-block h-[0.95em] w-[0.5ch] translate-y-[0.14em] bg-cyan-300/80 motion-safe:animate-pulse" />
    </span>
  );
}

export default function Home() {
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [activeScan, setActiveScan] = useState<ScanState | null>(null);
  const [startedTarget, setStartedTarget] = useState("");
  const [streamMode, setStreamMode] = useState<"stream" | "polling" | null>(null);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);
  const [hoveredStage, setHoveredStage] = useState<StageKey | null>(null);
  const [pinnedStage, setPinnedStage] = useState<StageKey | null>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeScanId) return;

    let disposed = false;
    const stopPolling = () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };

    const pullSnapshot = async () => {
      if (disposed) return;
      try {
        const res = await fetch(apiUrl(`/api/scan/${activeScanId}`));
        if (!res.ok) return;
        const data: ScanState = await res.json();
        if (disposed) return;
        setActiveScan(data);
        if (data.status === "complete" || data.status === "failed") {
          stopPolling();
        }
      } catch {
        if (!disposed) {
          setStreamWarning("Connection is unstable. Retrying scan updates...");
        }
      }
    };

    const startPolling = () => {
      if (disposed) return;
      if (pollingRef.current !== null) return;
      setStreamMode("polling");
      setStreamWarning("Live stream dropped. Switched to reliable polling.");
      void pullSnapshot();
      pollingRef.current = window.setInterval(() => {
        void pullSnapshot();
      }, 1400);
    };

    const stream = new EventSource(apiUrl(`/api/scan/${activeScanId}/stream`));

    stream.onmessage = (event) => {
      try {
        const data: ScanState = JSON.parse(event.data);
        if (disposed) return;
        setActiveScan(data);
        setStreamWarning(null);
        setStreamMode("stream");
        if (data.status === "complete" || data.status === "failed") {
          stream.close();
          stopPolling();
        }
      } catch {
        // ignore malformed stream chunks
      }
    };

    stream.onerror = () => {
      stream.close();
      startPolling();
    };

    return () => {
      disposed = true;
      stream.close();
      stopPolling();
    };
  }, [activeScanId]);

  const activeStageStatus = useMemo<Record<StageKey, StageStatus>>(() => {
    const initial: Record<StageKey, StageStatus> = {
      planner: "ready",
      recon: "queued",
      static: "queued",
      dependencies: "queued",
      secrets: "queued",
      report: "queued",
    };

    if (!activeScan) return initial;

    if (activeScan.status === "failed") {
      const failedAt = stageFromAgent(activeScan.current_agent) ?? "report";
      const failedIndex = PIPELINE_STAGES.findIndex((stage) => stage.key === failedAt);
      PIPELINE_STAGES.forEach((stage, index) => {
        if (index < failedIndex) initial[stage.key] = "complete";
        else if (index === failedIndex) initial[stage.key] = "failed";
      });
      return initial;
    }

    if (activeScan.status === "complete") {
      PIPELINE_STAGES.forEach((stage) => {
        initial[stage.key] = "complete";
      });
      return initial;
    }

    const current = stageFromAgent(activeScan.current_agent) ?? "planner";
    const currentIndex = PIPELINE_STAGES.findIndex((stage) => stage.key === current);

    PIPELINE_STAGES.forEach((stage, index) => {
      if (index < currentIndex) {
        initial[stage.key] = "complete";
        return;
      }
      if (index === currentIndex) {
        initial[stage.key] = "running";
        return;
      }
      initial[stage.key] = "queued";
    });

    return initial;
  }, [activeScan]);

  const runningStage = useMemo<StageKey | null>(() => {
    const found = PIPELINE_STAGES.find((stage) => activeStageStatus[stage.key] === "running");
    return found?.key ?? null;
  }, [activeStageStatus]);

  const activeStage = hoveredStage ?? pinnedStage ?? runningStage ?? "planner";

  const stageActivity = useMemo<Record<StageKey, string>>(() => {
    const fallback: Record<StageKey, string> = {
      planner: "Planner is ready to build the scan sequence.",
      recon: "Recon will begin once planning completes.",
      static: "Static/deep checks will run after reconnaissance.",
      dependencies: "Dependency and chain analysis will run in sequence.",
      secrets: "Secrets scanning runs after dependency stage.",
      report: "Report compiles once all scan stages complete.",
    };
    if (!activeScan) return fallback;

    const logs = activeScan.log ?? [];
    const pickLatest = (hints: string[], defaultText: string) => {
      for (let index = logs.length - 1; index >= 0; index -= 1) {
        const line = logs[index];
        const lower = line.toLowerCase();
        if (hints.some((hint) => lower.includes(hint))) {
          return line;
        }
      }
      return defaultText;
    };

    return {
      planner: pickLatest(STAGE_LOG_HINTS.planner, fallback.planner),
      recon: pickLatest(STAGE_LOG_HINTS.recon, fallback.recon),
      static: pickLatest(STAGE_LOG_HINTS.static, fallback.static),
      dependencies: pickLatest(STAGE_LOG_HINTS.dependencies, fallback.dependencies),
      secrets: pickLatest(STAGE_LOG_HINTS.secrets, fallback.secrets),
      report: pickLatest(STAGE_LOG_HINTS.report, fallback.report),
    };
  }, [activeScan]);

  function handleScanStarted(scanId: string, target: string) {
    setActiveScanId(scanId);
    setStartedTarget(target);
    setActiveScan(null);
    setStreamMode("stream");
    setStreamWarning(null);
  }

  return (
    <PlatformShell>
      <main className="page-shell flex min-h-screen items-center justify-center">
        <div className="page-container flex w-full flex-col items-center gap-6 md:gap-7">
          <section className="surface-panel relative w-full max-w-5xl overflow-hidden p-8 md:p-14">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[#030712]">
              <AuroraBlob className="left-[2%] top-[-16%] h-72 w-72 bg-indigo-500/22" delay={0} reduce={reduce} />
              <AuroraBlob className="bottom-[-24%] left-[30%] h-80 w-80 bg-cyan-500/14" delay={4} reduce={reduce} />
              <AuroraBlob className="right-[-6%] top-[20%] h-64 w-64 bg-violet-500/16" delay={2} reduce={reduce} />
              <Starfield reduce={reduce} />
            </div>

            <div className="relative z-10 flex flex-col items-center gap-5 text-center">
              <motion.div
                initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-white/15 bg-white/8 p-2.5 shadow-[0_0_44px_-8px_rgba(165,180,252,0.55)]"
              >
                <Image src="/image.png" alt="Polaris logo" width={44} height={44} className="rounded-xl" />
              </motion.div>

              <motion.p
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.4 }}
                className="text-sm font-semibold uppercase tracking-[0.32em] text-indigo-100/90"
              >
                Polaris
              </motion.p>

              <KineticHeadline reduce={reduce} />

              <motion.p
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.5 }}
                className="max-w-xl text-sm leading-relaxed text-slate-300/85 md:text-base"
              >
                Polaris scans your code, finds the weak points, and draws the attack paths between them as a constellation. Click a star, get the fix. The north star for your security backlog. Self-hosted, so your code never leaves your machine.
              </motion.p>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75, duration: 0.5 }}
                className="mt-1 inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#060b14]/85 px-3 py-2 font-mono text-xs text-slate-300"
              >
                <span className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-400/70" />
                  <span className="h-2 w-2 rounded-full bg-amber-400/70" />
                  <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
                </span>
                <span className="ml-1 text-slate-500">$</span>
                <Typewriter text="polaris scan ./your-repo --local" reduce={reduce} />
              </motion.div>
            </div>
          </section>

          <section id="scan-form" className="w-full max-w-5xl">
            <ScanForm redirectOnStart={false} onScanStarted={handleScanStarted} />
          </section>

          <section className="surface-panel w-full max-w-5xl p-4 md:p-5">
            <div className="mb-3 flex flex-col items-center justify-center gap-3 text-center">
              <div className="space-y-1">
                <p className="section-kicker">Agent Progress</p>
                <p className="text-sm font-medium leading-relaxed text-slate-200/88 md:text-[0.98rem]">
                  {activeScanId
                    ? `Tracking ${activeScan?.target || startedTarget} • #${activeScanId.slice(0, 8)}`
                    : "Start a scan to stream stage-by-stage progress here."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {activeScanId && activeScan?.status === "complete" ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/scan/${activeScanId}`)}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-300/45 bg-emerald-300/16 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 transition-colors hover:bg-emerald-300/26"
                  >
                    Open Completed Scan
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : activeScanId ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-300/25 bg-white/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                    Scan page unlocks after completion
                  </span>
                ) : (
                  <Link
                    href="/platform"
                    className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/90 transition-colors hover:text-cyan-100"
                  >
                    Platform View
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>

            {streamWarning ? (
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-[0.14em] text-amber-200/90">
                {streamWarning}
              </p>
            ) : null}
            {activeScanId && streamMode ? (
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-[0.14em] text-slate-300/85">
                Update mode: {streamMode}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {PIPELINE_STAGES.map((stage) => {
                const Icon = stage.icon;
                const stageStatus = activeStageStatus[stage.key];
                const isActiveStage = stage.key === activeStage;
                return (
                  <div
                    key={stage.key}
                    onMouseEnter={() => setHoveredStage(stage.key)}
                    onMouseLeave={() => setHoveredStage(null)}
                    onClick={() => setPinnedStage((current) => (current === stage.key ? null : stage.key))}
                    className={`surface-panel-muted flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors ${
                      isActiveStage ? "ring-1 ring-cyan-300/40" : ""
                    } ${stageCardClass(stageStatus)}`}
                    role="button"
                    aria-pressed={pinnedStage === stage.key}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPinnedStage((current) => (current === stage.key ? null : stage.key));
                      }
                    }}
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-[#0a1120] text-cyan-200">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{stage.label}</p>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${statusClass(stageStatus)}`}
                      >
                        {stageStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 rounded-xl border border-white/12 bg-[#0b1220]/70 px-3.5 py-3 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/90">
                {PIPELINE_STAGES.find((stage) => stage.key === activeStage)?.label} stage
              </p>
              <p className="mt-1 text-sm font-medium text-slate-100/95">
                {STAGE_OVERVIEW[activeStage]}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300/86">
                {stageActivity[activeStage]}
              </p>
            </div>

            {activeScan?.status === "complete" ? (
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200/90">
                Pipeline complete. Completed scan is now ready to open.
              </p>
            ) : null}
          </section>
        </div>
      </main>
    </PlatformShell>
  );
}
