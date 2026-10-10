"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Activity,
  ArrowLeft,
  Bot,
  BrainCircuit,
  Bug,
  CheckCircle2,
  GitBranch,
  Globe,
  Radar,
  Shield,
} from "lucide-react";
import { ScanForm } from "@/components/scan-form";
import { GlassPanel, PlatformShell, SectionHeading } from "@/components/platform-shell";
import { TrustNote } from "@/components/trust-note";
import { LiveActivityConsole } from "@/components/live-activity-console";

const HERO_METRICS = [
  { label: "Target Modes", value: "URL + Repo" },
  { label: "Specialist Agents", value: "10" },
  { label: "Live Telemetry", value: "SSE" },
  { label: "Report Output", value: "Markdown" },
];

const WORKFLOW_STEPS = [
  {
    icon: Globe,
    title: "Enter Target",
    description: "Provide a URL, GitHub repository, or local mounted repository path.",
  },
  {
    icon: BrainCircuit,
    title: "Agent Planning",
    description: "Polaris fingerprints the target and composes an adaptive scan plan.",
  },
  {
    icon: Radar,
    title: "Live Execution",
    description: "Specialist agents run tools in parallel and stream activity in real time.",
  },
  {
    icon: Shield,
    title: "Actionable Findings",
    description: "Severity-grouped findings and attack-chain context arrive in a structured report.",
  },
];

const TOOL_MODULES = [
  { name: "Planner", tools: "LLM + fingerprint", status: "running" },
  { name: "Recon", tools: "httpx · nmap · whatweb", status: "queued" },
  { name: "SQLi", tools: "sqlmap", status: "queued" },
  { name: "XSS", tools: "dalfox", status: "queued" },
  { name: "Static", tools: "semgrep · bandit", status: "idle" },
  { name: "Secrets", tools: "trufflehog", status: "idle" },
  { name: "Attack Chain", tools: "MITRE inference", status: "idle" },
  { name: "Report", tools: "LLM synthesis", status: "idle" },
] as const;

const SAMPLE_FINDINGS = [
  {
    severity: "critical",
    title: "SQL injection path in login endpoint",
    detail: "sqlmap detected injectable parameter in `/api/login` with stacked query behavior.",
  },
  {
    severity: "high",
    title: "Hardcoded credential discovered",
    detail: "trufflehog flagged exposed token pattern in `config/settings.py`.",
  },
  {
    severity: "medium",
    title: "Outdated dependency with known CVE",
    detail: "pip-audit identified vulnerable package version in lockfile.",
  },
];

const PREVIEW_LOGS = [
  "[planner] fingerprint complete: target type=repository, languages=Python, TypeScript",
  "[planner] execution plan selected: static -> deps_py -> deps_js -> secrets -> report",
  "[static] semgrep running against source tree",
  "[discovery] potential SQL injection sink identified in auth service",
  "[deps_py] pip-audit found 1 high-severity advisory",
  "[synthesis] final report queued with MITRE-aligned attack chain",
];

function ModuleStatusBadge({ status }: { status: (typeof TOOL_MODULES)[number]["status"] }) {
  const styles: Record<typeof status, string> = {
    running: "text-cyan-200 border-cyan-300/35 bg-cyan-300/10",
    queued: "text-violet-200 border-violet-300/35 bg-violet-300/10",
    idle: "text-slate-300 border-slate-300/25 bg-white/8",
  };

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest ${styles[status]}`}>
      {status}
    </span>
  );
}

function severityStyles(severity: string) {
  const map: Record<string, string> = {
    critical: "text-red-200 border-red-300/35 bg-red-400/10",
    high: "text-orange-200 border-orange-300/35 bg-orange-400/10",
    medium: "text-amber-200 border-amber-300/35 bg-amber-400/10",
  };
  return map[severity] ?? "text-slate-200 border-slate-300/35 bg-white/8";
}

export default function PlatformPage() {
  return (
    <PlatformShell>
      <main className="page-shell pb-16 pt-10 md:pb-20 md:pt-14">
        <div className="page-container space-y-10 md:space-y-12">
          <div className="flex justify-end">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-cyan-200 transition-opacity hover:opacity-75"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Launchpad
            </Link>
          </div>

          <section className="grid gap-6 lg:grid-cols-12 lg:items-stretch">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="surface-panel col-span-12 flex flex-col justify-between p-6 md:p-8 lg:col-span-7"
            >
              <div className="space-y-5">
                <p className="section-kicker">Detailed Platform Overview</p>
                <h1 className="text-balance text-4xl font-semibold leading-tight text-white md:text-5xl lg:text-[3.35rem] lg:leading-[1.03]">
                  Autonomous vulnerability scanning for websites and repositories.
                </h1>
                <p className="max-w-2xl text-base leading-relaxed text-slate-300/85">
                  Launch autonomous security scans across web targets and repositories using specialized agents. Polaris coordinates recon,
                  exploit simulation, dependency analysis, and report synthesis in one high-trust workflow.
                </p>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-mono uppercase tracking-[0.12em] text-cyan-100">
                  <Bot className="h-3.5 w-3.5" />
                  AI-powered agent pipeline
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {HERO_METRICS.map((item) => (
                  <div key={item.label} className="surface-panel-muted px-3 py-2.5">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-100">{item.value}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
              className="col-span-12 flex flex-col gap-4 lg:col-span-5"
            >
              <ScanForm />
              <TrustNote compact />
            </motion.div>
          </section>

          <section className="grid gap-6 lg:grid-cols-12">
            <GlassPanel className="col-span-12 p-5 md:p-6 lg:col-span-5">
              <SectionHeading
                kicker="Guided Workflow"
                title="From target input to report delivery"
                description="A clear operational path keeps scans explainable and demo-friendly from kickoff to findings export."
              />

              <div className="mt-6 space-y-3">
                {WORKFLOW_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <article key={step.title} className="surface-panel-muted px-3.5 py-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="rounded-md border border-white/10 bg-white/8 p-1 text-cyan-200">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <p className="text-sm font-medium text-slate-100">
                          {index + 1}. {step.title}
                        </p>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300/85">{step.description}</p>
                    </article>
                  );
                })}
              </div>
            </GlassPanel>

            <div className="col-span-12 grid gap-6 lg:col-span-7">
              <LiveActivityConsole
                entries={PREVIEW_LOGS}
                streaming
                title="Mission Console Preview"
                className="min-h-[20rem]"
              />

              <div className="grid gap-6 xl:grid-cols-2">
                <GlassPanel className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="section-kicker">Agent Modules</p>
                    <GitBranch className="h-4 w-4 text-cyan-200/80" />
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {TOOL_MODULES.map((module) => (
                      <div key={module.name} className="surface-panel-muted px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-100">{module.name}</p>
                          <ModuleStatusBadge status={module.status} />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">{module.tools}</p>
                      </div>
                    ))}
                  </div>
                </GlassPanel>

                <GlassPanel className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="section-kicker">Findings Output</p>
                    <Bug className="h-4 w-4 text-cyan-200/80" />
                  </div>
                  <div className="space-y-2.5">
                    {SAMPLE_FINDINGS.map((finding) => (
                      <article key={finding.title} className="surface-panel-muted px-3 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${severityStyles(
                              finding.severity,
                            )}`}
                          >
                            {finding.severity}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">structured finding</span>
                        </div>
                        <p className="text-sm font-medium text-slate-100">{finding.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300/80">{finding.detail}</p>
                      </article>
                    ))}
                  </div>
                </GlassPanel>
              </div>
            </div>
          </section>

          <footer className="surface-panel flex flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-6">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300/75">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Built for high-trust security demonstrations
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300/70">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/8 px-2 py-1">
                <Activity className="h-3.5 w-3.5 text-cyan-300" />
                Real-time stream
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/8 px-2 py-1">
                <Shield className="h-3.5 w-3.5 text-emerald-300" />
                Isolated scan runtime
              </span>
            </div>
          </footer>
        </div>
      </main>
    </PlatformShell>
  );
}
