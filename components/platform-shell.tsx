import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AnimatedBackground } from "@/components/animated-background";

interface PlatformShellProps {
  children: ReactNode;
  className?: string;
}

export function PlatformShell({ children, className }: PlatformShellProps) {
  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden text-white selection:bg-cyan-400/25",
        className,
      )}
    >
      <AnimatedBackground />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

interface SectionHeadingProps {
  kicker: string;
  title: string;
  description?: string;
  className?: string;
}

export function SectionHeading({
  kicker,
  title,
  description,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="section-kicker">{kicker}</span>
      <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
        {title}
      </h2>
      {description ? (
        <p className="max-w-3xl text-sm leading-relaxed text-slate-300/85 md:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
}

export function GlassPanel({ children, className }: GlassPanelProps) {
  return <div className={cn("surface-panel", className)}>{children}</div>;
}
