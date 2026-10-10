import {
  Activity,
  Binary,
  CheckCircle2,
  CircleDashed,
  FileCode2,
  FileSearch,
  Fingerprint,
  Globe,
  LoaderCircle,
  Link2,
  PackageSearch,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { ScanState } from "@/types/scan";

type AgentStatus = "idle" | "queued" | "running" | "completed" | "observed" | "issue";

interface Props {
  scan: ScanState;
  now?: number;
}

const AGENT_META: Record<
  string,
  {
    label: string;
    tools: string;
    icon: typeof Radar;
  }
> = {
  planner: {
    label: "Planner",
    tools: "Target fingerprint + adaptive plan",
    icon: Fingerprint,
  },
  recon: {
    label: "Recon",
    tools: "httpx + nmap + whatweb",
    icon: Globe,
  },
  sqli: {
    label: "SQL Injection",
    tools: "sqlmap",
    icon: Binary,
  },
  xss: {
    label: "XSS",
    tools: "dalfox",
    icon: Radar,
  },
  static_c: {
    label: "C/C++ Static",
    tools: "cppcheck + semgrep",
    icon: FileCode2,
  },
  static: {
    label: "Static Analysis",
    tools: "semgrep + bandit",
    icon: FileSearch,
  },
  deps_py: {
    label: "Python Dependencies",
    tools: "pip-audit",
    icon: PackageSearch,
  },
  deps_js: {
    label: "JavaScript Dependencies",
    tools: "npm audit",
    icon: PackageSearch,
  },
  secrets: {
    label: "Secrets",
    tools: "trufflehog + detect-secrets",
    icon: ShieldCheck,
  },
  attack_chain: {
    label: "Attack Chain",
    tools: "MITRE ATT&CK inference",
    icon: Link2,
  },
  report: {
    label: "Report",
    tools: "LLM synthesis",
    icon: Activity,
  },
};

const ALIASES: Record<string, string> = {
  sql_injection: "sqli",
  static_analysis: "static",
  dependencies: "deps_py",
  complete: "report",
};

function normalizeAgentKey(agentKey: string): string {
  return ALIASES[agentKey] ?? agentKey;
}

function fmtSecs(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusClass(status: AgentStatus): string {
  switch (status) {
    case "running":
      return "text-cyan-200 border-cyan-300/35 bg-cyan-300/10";
    case "completed":
      return "text-emerald-200 border-emerald-300/35 bg-emerald-300/10";
    case "issue":
      return "text-amber-200 border-amber-300/35 bg-amber-300/10";
    case "observed":
      return "text-sky-200 border-sky-300/35 bg-sky-300/10";
    case "queued":
      return "text-violet-200 border-violet-300/35 bg-violet-300/10";
    default:
      return "text-slate-300 border-slate-300/25 bg-white/8";
  }
}

function stageText(status: AgentStatus, tools: string): string {
  switch (status) {
    case "running":
      return `Running ${tools}`;
    case "completed":
      return `Completed ${tools}`;
    case "issue":
      return `Completed with findings from ${tools}`;
    case "observed":
      return `Completed with observations from ${tools}`;
    case "queued":
      return `Queued: waiting for previous stage`;
    default:
      return `Idle`;
  }
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "issue":
      return "issue found";
    case "observed":
      return "observed";
    case "queued":
      return "queued";
    default:
      return "idle";
  }
}

export function ScanProgress({ scan, now }: Props) {
  const normalizedPlan = scan.agents_plan.map(normalizeAgentKey).filter((key, index, arr) => arr.indexOf(key) === index);
  const executionPlan = ["planner", ...normalizedPlan].filter((key, index, arr) => arr.indexOf(key) === index && AGENT_META[key]);

  const visibleAgents =
    executionPlan.length > 0
      ? executionPlan
      : ["planner", "recon", "sqli", "xss", "static", "deps_py", "deps_js", "secrets", "attack_chain", "report"];

  const current = normalizeAgentKey(scan.current_agent);
  const currentIndex = executionPlan.indexOf(current);

  const findingsByAgent = scan.findings.reduce<Record<string, number>>((acc, finding) => {
    const key = normalizeAgentKey(finding.agent);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const actionableFindingsByAgent = scan.findings.reduce<Record<string, number>>((acc, finding) => {
    const key = normalizeAgentKey(finding.agent);
    const severity = String(finding.severity || "").toLowerCase();
    if (severity !== "info") {
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return acc;
  }, {});

  function getStatus(agent: string): AgentStatus {
    if (agent === "planner") {
      const planned = Boolean(scan.architecture_summary?.trim()) || normalizedPlan.length > 0;
      if (current === "planner") return "running";
      if (planned) return "completed";
      return "queued";
    }

    const inPlan = executionPlan.includes(agent);
    if (!inPlan) return "idle";

    if (current === agent && scan.status !== "complete") return "running";

    const agentIndex = executionPlan.indexOf(agent);
    const agentCompleted =
      scan.status === "complete" ||
      (currentIndex !== -1 && agentIndex !== -1 && agentIndex < currentIndex);

    if (agentCompleted) {
      if ((actionableFindingsByAgent[agent] ?? 0) > 0) return "issue";
      if ((findingsByAgent[agent] ?? 0) > 0) return "observed";
      return "completed";
    }

    return "queued";
  }

  function getTiming(agent: string, status: AgentStatus): string | null {
    const startedAt = scan.agent_timings?.[agent];
    if (!startedAt) return null;

    if (status === "running" && now) {
      return fmtSecs(Math.max(0, Math.floor(now - startedAt)));
    }

    if ((status === "completed" || status === "issue" || status === "observed") && now) {
      const order = executionPlan;
      const idx = order.indexOf(agent);
      let nextStart: number | undefined;
      for (let i = idx + 1; i < order.length; i += 1) {
        const probe = scan.agent_timings?.[order[i]];
        if (probe) {
          nextStart = probe;
          break;
        }
      }
      const end = nextStart ?? now;
      return fmtSecs(Math.max(0, Math.floor(end - startedAt)));
    }

    return null;
  }

  const statusByAgent = visibleAgents.reduce<Record<string, AgentStatus>>((acc, agent) => {
    acc[agent] = getStatus(agent);
    return acc;
  }, {});

  const completedCount = visibleAgents.filter((agent) => {
    const status = statusByAgent[agent];
    return status === "completed" || status === "issue" || status === "observed";
  }).length;

  const runningAgent = visibleAgents.find((agent) => statusByAgent[agent] === "running");
  const runningIndex = runningAgent ? visibleAgents.indexOf(runningAgent) : -1;
  const progressBase = visibleAgents.length > 0 ? (completedCount / visibleAgents.length) * 100 : 0;
  const progress = runningIndex !== -1 && visibleAgents.length > 0
    ? Math.min(100, progressBase + 45 / visibleAgents.length)
    : progressBase;
  const activeStep = scan.status === "complete"
    ? visibleAgents.length
    : runningIndex !== -1
      ? runningIndex + 1
      : Math.max(1, completedCount);
  const activeMeta = runningAgent ? AGENT_META[runningAgent] : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <article className="surface-panel-muted border-cyan-300/20 px-3.5 py-3 sm:col-span-2 xl:col-span-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/90">
            Runtime Progress
          </p>
          <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] font-medium text-slate-300">
            Step {activeStep}/{visibleAgents.length}
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full border border-white/10 bg-[#0b1220]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 transition-all duration-700"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>

        <p className="mt-2 text-[11px] text-slate-300/85">
          {activeMeta
            ? `Now running: ${activeMeta.label} (${activeMeta.tools})`
            : scan.status === "complete"
              ? "All agent stages completed."
              : "Waiting for first runnable stage."}
        </p>
      </article>

      {visibleAgents.map((agentKey) => {
        const meta = AGENT_META[agentKey];
        const Icon = meta.icon;
        const status = statusByAgent[agentKey];
        const timing = getTiming(agentKey, status);
        const findingCount = findingsByAgent[agentKey] ?? 0;

        return (
          <article
            key={agentKey}
            className={`surface-panel-muted relative overflow-hidden border-white/10 px-3.5 py-3 transition-all hover:border-cyan-300/20 ${
              status === "running" ? "ring-1 ring-cyan-300/35" : ""
            }`}
          >
            {status === "running" ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 scan-shimmer" />
            ) : null}

            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-white/10 bg-white/8 p-1.5 text-cyan-200">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-medium text-slate-100">{meta.label}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${statusClass(status)}`}
              >
                {status === "running" ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : status === "completed" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : status === "queued" ? (
                  <CircleDashed className="h-3 w-3" />
                ) : null}
                {statusLabel(status)}
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-400">{meta.tools}</p>
            <p className="mt-1 text-[11px] text-slate-300/80">{stageText(status, meta.tools)}</p>

            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span>
                findings: <span className="text-slate-300">{findingCount}</span>
              </span>
              {timing ? <span>{timing}</span> : <span>--</span>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
