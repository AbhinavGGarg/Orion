"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSearch,
  Globe,
  Layers3,
  Link2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformShell, GlassPanel, SectionHeading } from "@/components/platform-shell";
import { TrustNote } from "@/components/trust-note";
import { LiveActivityConsole } from "@/components/live-activity-console";
import { ScanProgress } from "@/components/scan-progress";
import { FindingCard } from "@/components/finding-card";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { FindingsChart } from "@/components/findings-chart";
import { NmapPortMap } from "@/components/nmap-port-map";
import { AttackChainGraph } from "@/components/attack-chain-graph";
import { SkyHud } from "@/components/sky-hud";
import { skyStats } from "@/components/attack-sky";

const AttackSky = dynamic(() => import("@/components/attack-sky").then((m) => m.AttackSky), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#02040c]" />,
});
import { ReportModal } from "@/components/report-modal";
import { Finding, ScanState } from "@/types/scan";
import { apiUrl, parseErrorDetail } from "@/lib/api";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

type SeverityKey = (typeof SEVERITY_ORDER)[number];

interface ReasoningBlock {
  agent: string;
  tokens: string[];
  done: boolean;
}

function buildReasoningBlocks(llmLog: string[]): ReasoningBlock[] {
  const blocks: ReasoningBlock[] = [];
  let current: ReasoningBlock | null = null;

  for (const entry of llmLog) {
    if (entry.startsWith("\x00START:")) {
      current = { agent: entry.slice(7), tokens: [], done: false };
      blocks.push(current);
      continue;
    }
    if (entry === "\x00END") {
      if (current) current.done = true;
      current = null;
      continue;
    }
    if (current) {
      current.tokens.push(entry);
    }
  }

  return blocks;
}

function inferTargetMode(scan: ScanState): string {
  const explicit = scan.target_type?.trim().toLowerCase();
  if (explicit === "url") return "Website / URL";
  if (explicit === "repo") return "Repository";

  const target = scan.target.trim().toLowerCase();
  if (target.startsWith("http://") || target.startsWith("https://")) {
    if (target.includes("github.com/")) return "GitHub Repository";
    return "Website / URL";
  }
  return "Local Repository";
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    pending: "text-slate-200 border-slate-300/25 bg-white/8",
    running: "text-cyan-200 border-cyan-300/30 bg-cyan-300/10",
    complete: "text-emerald-200 border-emerald-300/30 bg-emerald-300/10",
    failed: "text-red-200 border-red-300/30 bg-red-300/10",
  };
  return map[status] ?? map.pending;
}

function severityClass(severity: SeverityKey): string {
  const map: Record<SeverityKey, string> = {
    critical: "text-red-200 border-red-400/35 bg-red-300/10",
    high: "text-orange-200 border-orange-400/35 bg-orange-300/10",
    medium: "text-amber-200 border-amber-400/35 bg-amber-300/10",
    low: "text-blue-200 border-blue-400/35 bg-blue-300/10",
    info: "text-slate-200 border-slate-300/30 bg-white/8",
  };
  return map[severity];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function LlmReasoningPanel({ llmLog, isRunning }: { llmLog: string[]; isRunning: boolean }) {
  const blocks = useMemo(() => buildReasoningBlocks(llmLog), [llmLog]);
  const [showStream, setShowStream] = useState(false);
  const [expandedBlocks, setExpandedBlocks] = useState<Record<number, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showStream) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [showStream, blocks.length, llmLog.length]);

  return (
    <GlassPanel className="flex h-full min-h-[18rem] flex-col p-0">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="status-dot bg-violet-300" />
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-violet-100/80">
            LLM Reasoning Stream
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-mono text-slate-300">
          {blocks.length} blocks
        </span>
      </header>

      {blocks.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-5">
          <p className="text-sm text-slate-400">
            {isRunning ? "Waiting for model token stream..." : "No LLM reasoning captured for this run."}
          </p>
          <div className="space-y-2">
            <Skeleton className="h-2.5 w-2/5 bg-white/10" />
            <Skeleton className="h-2.5 w-full bg-white/10" />
            <Skeleton className="h-2.5 w-4/5 bg-white/10" />
          </div>
        </div>
      ) : !showStream ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-5">
          <p className="text-sm text-slate-300/85">
            Reasoning/code output is available but hidden by default to keep the layout focused.
          </p>
          <Button
            variant="outline"
            className="w-fit border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
            onClick={() => setShowStream(true)}
          >
            Show reasoning stream
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div ref={ref} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="h-8 border-white/15 bg-white/8 text-xs text-slate-100 hover:bg-white/12"
              onClick={() => setShowStream(false)}
            >
              Hide reasoning stream
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          {blocks.map((block, index) => (
            <article key={`${block.agent}-${index}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              {(() => {
                const fullText = block.tokens.join("");
                const isExpanded = expandedBlocks[index] ?? false;
                const preview =
                  fullText.length > 520 ? `${fullText.slice(0, 520)}...` : fullText;

                return (
                  <>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="rounded-full border border-violet-300/35 bg-violet-300/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-violet-100">
                        {block.agent}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">
                          {block.done ? "complete" : "streaming"}
                        </span>
                        <Button
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px] font-mono text-slate-300 hover:bg-white/10 hover:text-white"
                          onClick={() =>
                            setExpandedBlocks((prev) => ({
                              ...prev,
                              [index]: !(prev[index] ?? false),
                            }))
                          }
                        >
                          {isExpanded ? (
                            <>
                              Collapse
                              <ChevronDown className="h-3.5 w-3.5" />
                            </>
                          ) : (
                            <>
                              Expand
                              <ChevronRight className="h-3.5 w-3.5" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-200/90">
                      {isExpanded ? fullText : preview}
                      {!block.done && index === blocks.length - 1 ? (
                        <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-violet-300 align-middle" />
                      ) : null}
                    </p>
                  </>
                );
              })()}
            </article>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

function SeverityGroup({
  severity,
  findings,
  onSelect,
  startIndex,
}: {
  severity: SeverityKey;
  findings: Finding[];
  onSelect: (finding: Finding) => void;
  startIndex: number;
}) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${severityClass(
            severity,
          )}`}
        >
          {severity}
        </span>
        <span className="text-xs font-mono text-slate-400">{findings.length} finding(s)</span>
      </div>

      {findings.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3 text-xs text-slate-500">
          No {severity} findings in this scan.
        </p>
      ) : (
        <div className="space-y-3">
          {findings.map((finding, idx) => (
            <FindingCard
              key={`${severity}-${idx}-${finding.title}`}
              finding={finding}
              index={startIndex + idx}
              onClick={onSelect}
            />
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [scan, setScan] = useState<ScanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);
  const [updateMode, setUpdateMode] = useState<"stream" | "polling" | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!id) return;

    let disposed = false;
    let pollTimer: number | null = null;

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const fetchSnapshot = async () => {
      if (disposed) return;
      try {
        const res = await fetch(apiUrl(`/api/scan/${id}`));
        if (!res.ok) {
          if (res.status === 404) {
            const detail = await parseErrorDetail(res);
            setError(detail || "Scan not found");
            stopPolling();
            return;
          }
          return;
        }
        const data: ScanState = await res.json();
        if (disposed) return;
        setScan(data);
        if (data.status === "complete" || data.status === "failed") {
          stopPolling();
        }
      } catch {
        if (!disposed) {
          setStreamWarning("Connection is unstable. Retrying updates...");
        }
      }
    };

    const startPolling = () => {
      if (disposed) return;
      if (pollTimer !== null) return;
      setUpdateMode("polling");
      setStreamWarning("Live stream dropped. Switched to reliable polling.");
      void fetchSnapshot();
      pollTimer = window.setInterval(() => {
        void fetchSnapshot();
      }, 1400);
    };

    const es = new EventSource(apiUrl(`/api/scan/${id}/stream`));

    es.onmessage = (event) => {
      try {
        const data: ScanState = JSON.parse(event.data);
        if (disposed) return;
        setScan(data);
        setUpdateMode("stream");
        setStreamWarning(null);
        if (data.status === "complete" || data.status === "failed") {
          es.close();
          stopPolling();
        }
      } catch {
        // ignore malformed chunks from stream
      }
    };

    es.onerror = () => {
      es.close();
      startPolling();
    };

    return () => {
      disposed = true;
      es.close();
      stopPolling();
    };
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  async function openReportModal() {
    if (!id) return;

    setIsReportOpen(true);
    setReportLoading(true);
    setReportError(null);

    try {
      const response = await fetch(apiUrl(`/api/scan/${id}/report`));
      const data = await response.json();
      setReportMarkdown(data.report || "No report generated.");
    } catch {
      setReportError("Failed to load detailed report");
    } finally {
      setReportLoading(false);
    }
  }

  function downloadReport() {
    if (!reportMarkdown || !id) return;
    const blob = new Blob([reportMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orion-report-${id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <PlatformShell>
        <main className="page-shell flex min-h-[70vh] items-center justify-center py-10">
          <GlassPanel className="max-w-lg px-6 py-8 text-center">
            <p className="mb-2 text-sm font-semibold text-red-200">Scan Stream Error</p>
            <p className="text-sm text-slate-300">{error}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={goBack}
                className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/")}
                className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
              >
                New Target
              </Button>
            </div>
          </GlassPanel>
        </main>
      </PlatformShell>
    );
  }

  if (!scan) {
    return (
      <PlatformShell>
        <main className="page-shell py-10">
          <div className="page-container grid gap-6 lg:grid-cols-12">
            <GlassPanel className="col-span-12 p-5 lg:col-span-8">
              <div className="mb-4 flex items-center gap-2">
                <span className="status-dot animate-pulse bg-cyan-300" />
                <p className="text-sm text-slate-300">Connecting to autonomous scan stream...</p>
              </div>
              <div className="space-y-3">
                <Skeleton className="h-4 w-2/3 bg-white/10" />
                <Skeleton className="h-4 w-full bg-white/10" />
                <Skeleton className="h-4 w-5/6 bg-white/10" />
              </div>
            </GlassPanel>
            <GlassPanel className="col-span-12 p-5 lg:col-span-4">
              <div className="space-y-3">
                {[0, 1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-16 w-full bg-white/10" />
                ))}
              </div>
            </GlassPanel>
          </div>
        </main>
      </PlatformShell>
    );
  }

  const targetMode = inferTargetMode(scan);
  const isRunning = scan.status === "running" || scan.status === "pending";
  const elapsed = scan.started_at > 0 ? Math.max(0, Math.floor(now - scan.started_at)) : 0;

  const severityCounts = SEVERITY_ORDER.reduce<Record<SeverityKey, number>>(
    (acc, severity) => {
      acc[severity] = scan.findings.filter((finding) => finding.severity === severity).length;
      return acc;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
  );

  const groupedFindings = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: scan.findings.filter((finding) => finding.severity === severity),
  }));

  const totalFindings = scan.findings.length;
  const findingStarts = groupedFindings.reduce<Record<SeverityKey, number>>(
    (acc, group, index) => {
      if (index === 0) {
        acc[group.severity] = 0;
      } else {
        const prev = groupedFindings[index - 1];
        acc[group.severity] = acc[prev.severity] + prev.items.length;
      }
      return acc;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
  );

  const stats = skyStats(scan);

  return (
    <PlatformShell>
      {/* The sky: full screen, findings as stars, attack chain as lines. */}
      <section className="relative h-svh w-full overflow-hidden bg-[#02040c]">
        <AttackSky scan={scan} onSelect={setSelectedFinding} />
        <SkyHud
          scan={scan}
          now={now}
          stars={stats.stars}
          paths={stats.paths}
          chainSource={stats.chainSource}
          onDetails={() => document.getElementById("details")?.scrollIntoView({ behavior: "smooth" })}
          onReport={() => router.push(`/report/${scan.scan_id}`)}
        />
      </section>

      <main id="details" className="page-shell py-6 md:py-8">
        <div className="page-container flex flex-col gap-4">
          <GlassPanel className="p-4 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="section-kicker">Active Scan</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider ${statusClass(scan.status)}`}>
                    {scan.status}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/8 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-300">
                    {targetMode}
                  </span>
                </div>

                <h1 className="text-balance text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  {isRunning ? "Autonomous scan in progress" : "Scan execution complete"}
                </h1>

                <p className="max-w-3xl font-mono text-xs text-slate-300/80">{scan.target}</p>

                <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-300/80">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5 text-cyan-200" />
                    elapsed: {formatDuration(elapsed)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-cyan-200" />
                    findings: {totalFindings}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers3 className="h-3.5 w-3.5 text-cyan-200" />
                    agents: {scan.agents_plan.length || "pending"}
                  </span>
                  {updateMode ? (
                    <span className="inline-flex items-center gap-1.5">
                      update mode: {updateMode}
                    </span>
                  ) : null}
                </div>
                {streamWarning ? (
                  <p className="text-[11px] font-mono uppercase tracking-wider text-amber-200/90">
                    {streamWarning}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={goBack}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/")}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                >
                  New Target
                </Button>

                <Button
                  variant="outline"
                  onClick={() => router.push(`/report/${scan.scan_id}`)}
                  disabled={scan.status !== "complete"}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                  title={scan.status === "complete" ? "Open report page" : "Report page unlocks after scan completes"}
                >
                  Open Report Page
                </Button>

                <Button
                  onClick={openReportModal}
                  disabled={scan.status !== "complete"}
                  className="bg-gradient-to-r from-cyan-400 to-blue-500 font-semibold text-slate-950 hover:brightness-110 disabled:opacity-50"
                >
                  Detailed Report
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </GlassPanel>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {SEVERITY_ORDER.map((severity) => (
              <div key={severity} className="surface-panel-muted px-3 py-3">
                <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">{severity}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">{severityCounts[severity]}</p>
              </div>
            ))}
          </section>

          <div>
            <div className="space-y-4 pb-1 md:space-y-6">
              <section className="grid gap-6 lg:grid-cols-12">
                <div className="col-span-12 grid gap-6 lg:col-span-8">
                  <LiveActivityConsole
                    entries={scan.log}
                    streaming={isRunning}
                    title="Execution Console"
                    emptyLabel={isRunning ? "Waiting for planner output" : "No execution log captured"}
                  />
                  <LlmReasoningPanel llmLog={scan.llm_log} isRunning={isRunning} />
                </div>

                <div className="col-span-12 grid gap-6 lg:col-span-4">
                  <GlassPanel className="p-4">
                    <SectionHeading
                      kicker="Agent Orchestration"
                      title="Module Status"
                      description="Agent-level states across planning, tooling, and synthesis."
                    />
                    <div className="mt-4">
                      <ScanProgress scan={scan} now={now} />
                    </div>
                  </GlassPanel>

                  <GlassPanel className="p-4">
                    <p className="section-kicker mb-2">Target Intelligence</p>
                    <p className="text-sm leading-relaxed text-slate-300/85">
                      {scan.architecture_summary?.trim() || "Planner summary will appear once target fingerprinting is complete."}
                    </p>
                  </GlassPanel>

                  <TrustNote compact />
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeading
                  kicker="Findings"
                  title="Severity-grouped vulnerability output"
                  description="Review each issue with source tool, affected surface, and remediation preview."
                />

                {totalFindings === 0 && isRunning ? (
                  <GlassPanel className="p-5">
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="status-dot animate-pulse bg-emerald-300" />
                      Scan engines are running. Findings will populate here in real time.
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {[0, 1, 2].map((item) => (
                        <Skeleton key={item} className="h-40 w-full bg-white/10" />
                      ))}
                    </div>
                  </GlassPanel>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {groupedFindings.map((group) => (
                      <SeverityGroup
                        key={group.severity}
                        severity={group.severity}
                        findings={group.items}
                        onSelect={setSelectedFinding}
                        startIndex={findingStarts[group.severity]}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="grid gap-6 lg:grid-cols-12">
                <GlassPanel className="col-span-12 p-4 lg:col-span-5">
                  <div className="mb-3 flex items-center gap-2">
                    <FileSearch className="h-4 w-4 text-cyan-200" />
                    <p className="section-kicker">Findings by Component</p>
                  </div>
                  <FindingsChart scan={scan} />
                </GlassPanel>

                <GlassPanel className="col-span-12 p-4 lg:col-span-7">
                  <div className="mb-3 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-cyan-200" />
                    <p className="section-kicker">Open Ports</p>
                  </div>
                  <NmapPortMap scan={scan} />
                </GlassPanel>
              </section>

              <GlassPanel className="p-4 md:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-cyan-200" />
                  <p className="section-kicker">Attack Chain (step by step)</p>
                </div>
                <AttackChainGraph scan={scan} />
              </GlassPanel>
            </div>
          </div>
        </div>
      </main>

      <ReportModal
        open={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        report={reportMarkdown}
        loading={reportLoading}
        error={reportError}
        target={scan.target}
        scanId={scan.scan_id}
        onDownload={downloadReport}
      />

      <EvidenceDrawer finding={selectedFinding} onClose={() => setSelectedFinding(null)} />
    </PlatformShell>
  );
}
