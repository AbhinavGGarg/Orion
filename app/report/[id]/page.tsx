"use client";

import React, { useMemo, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ArrowLeft, Calendar, Check, Download, FileText, ListChecks, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { PlatformShell, GlassPanel, SectionHeading } from "@/components/platform-shell";
import { apiUrl } from "@/lib/api";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-200 border border-red-400/35 font-semibold",
  high: "bg-orange-500/15 text-orange-200 border border-orange-400/35 font-semibold",
  medium: "bg-amber-500/15 text-amber-200 border border-amber-400/35 font-semibold",
  low: "bg-blue-500/15 text-blue-200 border border-blue-400/35",
  info: "bg-white/8 text-slate-200 border border-slate-300/30",
};

function SeverityBadge({ children }: { children: React.ReactNode }) {
  const key = String(children).toLowerCase().trim();
  const cls = SEVERITY_STYLES[key];
  if (!cls) return <>{children}</>;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] uppercase tracking-widest ${cls}`}>
      {children}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="absolute right-2 top-2 rounded border border-white/10 bg-white/8 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:bg-white/15"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function TdCell({ children }: { children?: React.ReactNode }) {
  const key = String(children).toLowerCase().trim();
  const isSeverity = ["critical", "high", "medium", "low", "info"].includes(key);
  return (
    <td className="px-4 py-2.5 align-top text-sm text-slate-300/85">
      {isSeverity ? <SeverityBadge>{children}</SeverityBadge> : children}
    </td>
  );
}

const mdComponents: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-0 text-3xl font-semibold tracking-tight text-white">{children}</h1>,
  h2: ({ children }) => (
    <div className="mb-4 mt-10">
      <h2 className="border-b border-white/12 pb-2.5 text-lg font-semibold tracking-tight text-white">{children}</h2>
    </div>
  ),
  h3: ({ children }) => (
    <h3 className="mb-3 mt-8 flex items-center gap-2.5 text-base font-semibold text-white">
      <span className="inline-block h-4 w-1 rounded-sm bg-cyan-300/60" />
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-slate-300/85">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-300/85">{children}</em>,
  hr: () => <hr className="my-8 border-white/12" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-cyan-300/45 pl-4 text-sm italic text-slate-300/75">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-slate-300/85">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-slate-300/85">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const value = String(children).replace(/\n$/, "");
    const language = (className ?? "").replace("language-", "").toLowerCase();

    if (language === "mermaid") {
      return <MermaidDiagram chart={value} />;
    }

    if (className) {
      return (
        <div className="group relative my-5">
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#070d18] px-5 py-4 font-mono text-xs leading-relaxed text-slate-200">
            <code className={`${className} font-mono text-xs text-slate-200`}>{children}</code>
          </pre>
          {value ? <CopyButton text={value} /> : null}
        </div>
      );
    }

    return <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-100">{children}</code>;
  },
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-white/12">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/8 text-[11px] uppercase tracking-widest text-slate-300">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-white/10">{children}</tbody>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-white/[0.04]">{children}</tr>,
  th: ({ children }) => <th className="px-4 py-3 text-left font-semibold">{children}</th>,
  td: TdCell as Components["td"],
  a: ({ href, children }) => (
    <span
      className="text-cyan-200"
      title={href ? `Link removed for reliability: ${href}` : "Link removed for reliability"}
    >
      {children}
    </span>
  ),
};

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [report, setReport] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fixesCopied, setFixesCopied] = useState(false);

  const scanDate = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const [reportRes, scanRes] = await Promise.all([
          fetch(apiUrl(`/api/scan/${id}/report`)),
          fetch(apiUrl(`/api/scan/${id}`)),
        ]);

        const reportData = await reportRes.json();
        const scanData = await scanRes.json();

        setReport(reportData.report || "No report generated.");
        setTarget(scanData.target ?? "");
      } catch {
        setError("Failed to load report");
      }
    }

    load();
  }, [id]);

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  function downloadReport() {
    if (!report || !id) return;

    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orion-report-${id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Pull just the actionable fixes out of the report so they can be pasted into a ticket or PR.
  function extractFixes(md: string): string {
    const plan = md.match(/##\s*Remediation Plan[\s\S]*?(?=\n##\s|\n#\s|$)/i);
    if (plan) return plan[0].trim();
    const fixes = [...md.matchAll(/\*\*Remediation:\*\*\s*(.+)/gi)].map((m) => `- [ ] ${m[1].trim()}`);
    return fixes.length ? `## Remediation Plan\n\n${fixes.join("\n")}` : md;
  }

  function copyFixes() {
    if (!report) return;
    const header = `# Remediation checklist \u2014 ${target || "scan"}\n\n`;
    navigator.clipboard.writeText(header + extractFixes(report)).then(
      () => {
        setFixesCopied(true);
        setTimeout(() => setFixesCopied(false), 1800);
      },
      () => {},
    );
  }

  if (error) {
    return (
      <PlatformShell>
        <main className="page-shell flex min-h-[70vh] items-center justify-center py-10">
          <GlassPanel className="max-w-lg px-6 py-7 text-center">
            <p className="mb-2 text-sm font-semibold text-red-200">Report Error</p>
            <p className="text-sm text-slate-300">{error}</p>
          </GlassPanel>
        </main>
      </PlatformShell>
    );
  }

  if (report === null) {
    return (
      <PlatformShell>
        <main className="page-shell py-10">
          <div className="page-container max-w-4xl">
            <GlassPanel className="p-6">
              <p className="mb-4 text-sm text-slate-300">Building report view...</p>
              <div className="space-y-3">
                <div className="h-3 w-2/5 rounded scan-shimmer" />
                <div className="h-3 w-full rounded scan-shimmer" />
                <div className="h-3 w-5/6 rounded scan-shimmer" />
              </div>
            </GlassPanel>
          </div>
        </main>
      </PlatformShell>
    );
  }

  return (
    <PlatformShell>
      <main className="page-shell py-6 md:py-8">
        <div className="page-container space-y-6">
          <GlassPanel className="sticky top-20 z-20 p-4 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <SectionHeading
                  kicker="Vulnerability Report"
                  title="Structured findings and remediation guidance"
                  description="Review scanner output, attack-chain context, and markdown-ready evidence from this autonomous scan."
                />

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300/85">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/8 px-2.5 py-1 font-mono">
                    <FileText className="h-3.5 w-3.5 text-cyan-200" />
                    #{id?.slice(0, 8)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/8 px-2.5 py-1 font-mono">
                    <Calendar className="h-3.5 w-3.5 text-cyan-200" />
                    {scanDate}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/8 px-2.5 py-1 font-mono">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-200" />
                    Orion Pentest v0.1
                  </span>
                </div>

                <p className="font-mono text-xs text-slate-300/75">{target}</p>
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
                  onClick={downloadReport}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                >
                  <Download className="h-4 w-4" />
                  Export .md
                </Button>
                <Button
                  variant="outline"
                  onClick={copyFixes}
                  className="border-emerald-300/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
                >
                  {fixesCopied ? <Check className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
                  {fixesCopied ? "Copied" : "Copy fixes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/scan/${id}`)}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                >
                  Back to Scan
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/")}
                  className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                >
                  New Target
                </Button>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-5 md:p-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {report}
            </ReactMarkdown>
          </GlassPanel>
        </div>
      </main>
    </PlatformShell>
  );
}
