"use client";

import { useEffect, useMemo, useState, useId } from "react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string>("");
  const [hasError, setHasError] = useState(false);
  const reactId = useId();

  const renderId = useMemo(
    () => `polaris-mermaid-${reactId.replace(/[:]/g, "")}`,
    [reactId],
  );

  useEffect(() => {
    let active = true;

    async function renderChart() {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "var(--font-geist-sans), ui-sans-serif",
        });

        const { svg: rendered } = await mermaid.render(renderId, chart);
        if (!active) return;

        setSvg(rendered);
        setHasError(false);
      } catch {
        if (!active) return;
        setSvg("");
        setHasError(true);
      }
    }

    renderChart();

    return () => {
      active = false;
    };
  }, [chart, renderId]);

  if (hasError) {
    return (
      <div className="my-5 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-xs text-red-300">
        Unable to render Mermaid diagram.
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-5 rounded-xl border border-white/10 bg-[#0d0d0d] px-4 py-3 text-xs text-white/50">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/10 bg-[#0d0d0d] p-4">
      <div
        className="min-w-[460px] [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
