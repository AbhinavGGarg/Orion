"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ExternalLink, GitPullRequest, Loader2, Wrench, X } from "lucide-react";
import { apiUrl, parseErrorDetail } from "@/lib/api";

// "Fix it on GitHub": kicks off the backend fix job and shows its progress.
// The backend rewrites the affected files with the LLM, writes
// POLARIS_FIXES.md, pushes a branch and opens a pull request.

export interface FixJob {
  scan_id: string;
  status: "idle" | "running" | "done" | "failed";
  steps: string[];
  files: { path: string; finding: string; summary: string }[];
  manual: { finding: string; note: string }[];
  fixed_titles: string[];
  pr_url: string;
  pr_number: number;
  branch: string;
  error: string;
}

interface Props {
  scanId: string;
  open: boolean;
  onClose: () => void;
  onJob: (job: FixJob) => void;
}

export function FixPanel({ scanId, open, onClose, onJob }: Props) {
  const reduce = useReducedMotion();
  const [job, setJob] = useState<FixJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Poll while the job runs.
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/api/scan/${scanId}/fix`));
        if (!res.ok) return;
        const data: FixJob = await res.json();
        if (disposed) return;
        setJob(data);
        onJob(data);
        if (data.status === "running") timer = window.setTimeout(tick, 1200);
      } catch {
        if (!disposed) timer = window.setTimeout(tick, 2500);
      }
    };
    void tick();

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // onJob is stable enough for this; re-subscribing on every parent render would restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scanId, starting]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [job?.steps.length]);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(apiUrl(`/api/scan/${scanId}/fix`), { method: "POST" });
      if (!res.ok) {
        setError(await parseErrorDetail(res));
        return;
      }
      const data: FixJob = await res.json();
      setJob(data);
      onJob(data);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setStarting(false);
    }
  }

  const running = job?.status === "running" || starting;
  const done = job?.status === "done";
  const failed = job?.status === "failed";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-[#060b16] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 p-1.5 text-emerald-200">
                  <Wrench className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Fix it on GitHub</p>
                  <p className="text-[11px] text-slate-400">Rewrites the affected files and opens a pull request. Nothing lands until you merge.</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              {!job || job.status === "idle" ? (
                <div className="space-y-3">
                  <p className="text-sm leading-relaxed text-slate-300">
                    Polaris will take the critical, high and medium findings, find the file each one lives in, write the fix, and
                    open a pull request on a new branch with a <span className="font-mono text-slate-100">POLARIS_FIXES.md</span>{" "}
                    explaining every change.
                  </p>
                  {error && <p className="rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs text-red-100">{error}</p>}
                  <button
                    type="button"
                    onClick={start}
                    disabled={starting}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
                  >
                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequest className="h-4 w-4" />}
                    Open the fix PR
                  </button>
                </div>
              ) : (
                <>
                  <div ref={listRef} className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
                    {job.steps.map((line, i) => {
                      const last = i === job.steps.length - 1;
                      return (
                        <p key={`${i}-${line.slice(0, 20)}`} className={line.startsWith("  ") ? "pl-4 text-slate-400" : last && running ? "text-cyan-100" : "text-slate-200"}>
                          {last && running ? <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin text-cyan-300" /> : <span className="mr-1.5 text-emerald-300">›</span>}
                          {line.trim()}
                        </p>
                      );
                    })}
                  </div>

                  {job.files.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Files changed</p>
                      {job.files.map((f) => (
                        <div key={`${f.path}-${f.finding}`} className="flex items-start gap-2 text-xs">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                          <div className="min-w-0">
                            <p className="truncate font-mono text-slate-100">{f.path}</p>
                            <p className="text-slate-400">{f.summary}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {job.manual.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Needs a human</p>
                      {job.manual.map((m) => (
                        <p key={m.finding} className="text-xs text-slate-300">
                          <span className="text-amber-200">{m.finding}</span> <span className="text-slate-400">{m.note}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {failed && <p className="rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs text-red-100">{job.error}</p>}

                  {done && job.pr_url && (
                    <a
                      href={job.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                    >
                      <GitPullRequest className="h-4 w-4" />
                      Open pull request #{job.pr_number}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {failed && (
                    <button type="button" onClick={start} className="text-xs font-semibold text-cyan-200 hover:text-cyan-100">
                      Try again
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
