import { Database, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrustNoteProps {
  compact?: boolean;
  className?: string;
}

export function TrustNote({ compact = false, className }: TrustNoteProps) {
  return (
    <aside
      className={cn(
        "surface-panel-muted border-cyan-300/15 px-4 py-3 text-slate-200/80",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div className="space-y-2">
          <p className="font-medium text-slate-100">Security guardrails are active</p>
          <div className="grid gap-1.5 text-[0.8rem] text-slate-300/85">
            <p className="flex items-center gap-2">
              <ShieldEllipsis className="h-3.5 w-3.5 text-cyan-300/80" />
              URL scans are restricted to allowlisted hosts.
            </p>
            <p className="flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-emerald-300/80" />
              Repositories are cloned into isolated backend storage.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
