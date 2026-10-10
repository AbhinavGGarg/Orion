"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, ShieldAlert, Wrench, X } from "lucide-react";
import { Finding } from "@/types/scan";

const SEVERITY_STYLES: Record<string, { badge: string; border: string }> = {
  critical: { badge: "bg-red-400/20 text-red-200 border-red-300/35", border: "border-red-300/35" },
  high: { badge: "bg-orange-400/20 text-orange-200 border-orange-300/35", border: "border-orange-300/35" },
  medium: { badge: "bg-amber-400/20 text-amber-200 border-amber-300/35", border: "border-amber-300/35" },
  low: { badge: "bg-blue-400/20 text-blue-200 border-blue-300/35", border: "border-blue-300/35" },
  info: { badge: "bg-white/10 text-slate-200 border-slate-300/30", border: "border-slate-300/30" },
};

const FALLBACK_FIX =
  "Review the affected code path, enforce input/output controls, and apply targeted patches before rerunning the scan.";

interface Props {
  finding: Finding | null;
  onClose: () => void;
}

export function EvidenceDrawer({ finding, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!finding) return;

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
  }, [finding, onClose]);

  // Reset the copied state whenever a different finding is opened (render-time reset).
  const [lastFinding, setLastFinding] = useState<Finding | null>(finding);
  if (finding !== lastFinding) {
    setLastFinding(finding);
    setCopied(false);
  }

  const styles = finding ? SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info : SEVERITY_STYLES.info;
  const fixText = (finding?.remediation || "").trim() || FALLBACK_FIX;

  async function copyFix() {
    if (!finding) return;
    const payload = `${finding.title} (${finding.severity})\nComponent: ${finding.component || "n/a"}\n\nFix:\n${fixText}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable (insecure context); fail silently.
    }
  }

  return (
    <AnimatePresence>
      {finding ? (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.15 }}
        >
          <motion.div className="absolute inset-0 bg-[#010409]/75 backdrop-blur-sm" onClick={onClose} />

          <motion.aside
            className={`relative flex h-full w-full max-w-2xl flex-col border-l bg-[#050b17] shadow-2xl ${styles.border}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-5 py-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles.badge}`}>
                    {finding.severity}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                    {finding.tool || "scanner"}
                  </span>
                  {finding.component ? (
                    <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-mono text-cyan-100">
                      {finding.component}
                    </span>
                  ) : null}
                </div>
                <h2 className="text-base font-semibold leading-snug text-white">{finding.title}</h2>
              </div>

              <button
                onClick={onClose}
                aria-label="Close evidence drawer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/8 text-slate-200 transition-colors hover:bg-white/14"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {/* Fix leads — the whole point is helping the owner remediate. */}
              <section className="rounded-xl border border-emerald-300/30 bg-emerald-400/[0.06] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-200">
                    <Wrench className="h-3.5 w-3.5" />
                    How to fix
                  </p>
                  <button
                    onClick={copyFix}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100 transition-colors hover:bg-emerald-400/20"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy fix"}
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-emerald-50/90">{fixText}</p>
              </section>

              <section>
                <p className="section-kicker mb-2">Why it matters</p>
                <p className="text-sm leading-relaxed text-slate-300/85">{finding.description}</p>
              </section>

              {finding.evidence ? (
                <section>
                  <p className="section-kicker mb-2">Evidence</p>
                  <pre className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-[#040913] p-4 font-mono text-xs leading-relaxed text-slate-200">
                    {finding.evidence}
                  </pre>
                </section>
              ) : null}

              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="grid gap-2 text-xs text-slate-300/80">
                  <p className="inline-flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-cyan-200" />
                    agent: <span className="font-mono text-slate-100">{finding.agent || "unknown"}</span>
                  </p>
                  <p className="inline-flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5 text-cyan-200" />
                    tool: <span className="font-mono text-slate-100">{finding.tool || "unknown"}</span>
                  </p>
                </div>
              </section>
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
