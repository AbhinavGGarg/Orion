import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { coverageGraph, reportGraph, type ScanSnapshot, type SkyGraph } from "@/lib/constellation-model";

const PolarisConstellation = lazy(() => import("@/components/ui/polaris-constellation"));

function Constellation({ host }: { host: HTMLElement }) {
  const isReport = host.dataset.constellation === "report";
  const [graph, setGraph] = useState<SkyGraph | null>(isReport ? null : coverageGraph);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "100px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    if (!isReport) return;
    const onReport = (event: Event) => setGraph(reportGraph((event as CustomEvent<ScanSnapshot>).detail));
    window.addEventListener("polaris:report", onReport);
    window.dispatchEvent(new Event("polaris:report-request"));
    return () => window.removeEventListener("polaris:report", onReport);
  }, [isReport]);

  if (!visible || !graph) return <p className="sky-loading">{isReport ? "Loading saved findings…" : "Explore your app's constellation below."}</p>;
  return <Suspense fallback={<p className="sky-loading">Loading constellation…</p>}>
    <PolarisConstellation graph={graph} onSelect={id => {
      if (isReport) window.dispatchEvent(new CustomEvent("polaris:select-finding", { detail: id }));
    }} />
  </Suspense>;
}

for (const host of document.querySelectorAll<HTMLElement>("[data-constellation]")) {
  createRoot(host).render(<Constellation host={host} />);
}
