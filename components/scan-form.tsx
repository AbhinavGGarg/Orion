"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Globe, Github, Play, TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import { apiUrl, getApiBaseUrl, parseErrorDetail } from "@/lib/api";

interface ScanFormProps {
  redirectOnStart?: boolean;
  onScanStarted?: (scanId: string, target: string) => void;
}

const EXAMPLE_TARGETS = [
  {
    label: "Web Demo",
    value: "http://testphp.vulnweb.com",
    hint: "faster vulnerable demo",
  },
  {
    label: "GitHub Repo",
    value: "https://github.com/trottomv/python-insecure-app",
    hint: "repository workflow",
  },
] as const;

function inferTargetType(target: string): "url" | "github" | "unknown" {
  const value = target.trim().toLowerCase();
  if (!value) return "unknown";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (value.includes("github.com/")) {
      return "github";
    }
    return "url";
  }
  return "unknown";
}

function TargetTypePill({ target }: { target: string }) {
  const type = useMemo(() => inferTargetType(target), [target]);

  const map = {
    url: {
      label: "Website / URL scan",
      icon: Globe,
      className: "text-cyan-200 border-cyan-300/35 bg-cyan-400/10",
    },
    github: {
      label: "GitHub repository scan",
      icon: Github,
      className: "text-violet-200 border-violet-300/35 bg-violet-400/10",
    },
    unknown: {
      label: "Auto-detecting target type",
      icon: ArrowUpRight,
      className: "text-slate-200 border-slate-300/30 bg-white/8",
    },
  } as const;

  const meta = map[type];
  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}
      aria-live="polite"
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

export function ScanForm({ redirectOnStart = true, onScanStarted }: ScanFormProps) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const apiBase = useMemo(() => getApiBaseUrl(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target.trim()) {
      toast.error("Please enter a website URL or GitHub repository");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(apiUrl("/api/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim() }),
      });

      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        throw new Error(detail);
      }

      const data = await res.json();
      toast.success("Scan started");
      onScanStarted?.(data.scan_id, target.trim());
      if (redirectOnStart) {
        router.push(`/scan/${data.scan_id}`);
        return;
      }
      setLoading(false);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
        if (!apiBase && typeof window !== "undefined") {
          toast.error(
            "Cannot reach backend API. Set BACKEND_API_URL in deployment (or NEXT_PUBLIC_API_URL for direct calls).",
          );
        } else {
          toast.error("Network error: unable to reach scan backend.");
        }
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to start scan");
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="surface-panel flex w-full flex-col gap-4 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="section-kicker">Scan Command Center</p>
        <TargetTypePill target={target} />
      </div>

      <div className="rounded-xl border border-white/15 bg-[#070c18] p-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <label htmlFor="target-input" className="sr-only">
            Target input
          </label>
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyan-200/70">
              <TerminalSquare className="h-4 w-4" />
            </span>
            <input
              id="target-input"
              type="text"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="https://scanme.nmap.org or https://github.com/org/repo"
              className="h-12 w-full rounded-lg border border-white/10 bg-[#090f1d] pl-10 pr-3 font-mono text-sm text-slate-100 outline-none transition-all placeholder:text-slate-500 focus:border-cyan-300/50 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.15)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-5 text-sm font-semibold text-slate-950 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70 md:min-w-[11rem]"
          >
            <Play className="h-4 w-4" />
            {loading ? "Launching Scan" : "Run Scan"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Example targets
        </span>
        {EXAMPLE_TARGETS.map((example) => (
          <button
            key={example.value}
            type="button"
            onClick={() => setTarget(example.value)}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 transition-all hover:border-cyan-300/35 hover:bg-cyan-400/12 hover:text-cyan-100"
          >
            <span className="font-medium">{example.label}</span>
            <span className="text-slate-400">{example.hint}</span>
          </button>
        ))}
      </div>

      <p className="text-sm leading-relaxed text-slate-200/84 md:text-[0.97rem]">
        Tip: Website URL scans are usually faster. GitHub repository full scans typically take about 5-7 minutes (large repos may take longer).
      </p>
    </form>
  );
}
