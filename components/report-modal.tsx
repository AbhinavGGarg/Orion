"use client";

import React, { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MermaidDiagram } from "@/components/mermaid-diagram";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  report: string | null;
  loading: boolean;
  error: string | null;
  target: string;
  scanId: string;
  onDownload: () => void;
}

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
        <div className="my-5">
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#070d18] px-5 py-4 font-mono text-xs leading-relaxed text-slate-200">
            <code className={`${className} font-mono text-xs text-slate-200`}>{children}</code>
          </pre>
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

export function ReportModal({
  open,
  onClose,
  report,
  loading,
  error,
  target,
  scanId,
  onDownload,
}: ReportModalProps) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.15 }}
        >
          <motion.div className="absolute inset-0 bg-[#010409]/78 backdrop-blur-sm" onClick={onClose} />

          <div className="relative flex h-full w-full items-center justify-center p-4 md:p-8">
            <motion.section
              role="dialog"
              aria-modal="true"
              className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#050c18] shadow-2xl"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex h-15 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white md:text-base">Detailed Vulnerability Report</h2>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-300/75">
                    {target} • #{scanId.slice(0, 8)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDownload}
                    className="border-white/15 bg-white/8 text-slate-100 hover:bg-white/12"
                  >
                    <Download className="h-4 w-4" />
                    Export .md
                  </Button>
                  <button
                    onClick={onClose}
                    aria-label="Close report"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-white/8 text-slate-200 transition-colors hover:bg-white/12"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-sm text-slate-300">
                      <span className="status-dot animate-pulse bg-cyan-300" />
                      Loading report...
                    </div>
                  </div>
                ) : null}

                {!loading && error ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="rounded-lg border border-red-300/25 bg-red-400/10 px-4 py-2 text-sm text-red-200">{error}</p>
                  </div>
                ) : null}

                {!loading && !error && report ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {report}
                  </ReactMarkdown>
                ) : null}
              </div>
            </motion.section>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
