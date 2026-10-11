export interface SkyNode {
  id: string;
  label: string;
  severity: string;
  detail: string;
  findingId?: string;
  agent?: "scout" | "analyst" | "fixer";
}

export const constellationAgents: SkyNode[] = [
  { id: "agent:scout", agent: "scout", label: "Scout", severity: "context", detail: "Simulation agent: locates the file or route associated with a finding. It does not run a new scan." },
  { id: "agent:analyst", agent: "analyst", label: "Analyst", severity: "context", detail: "Simulation agent: reviews the finding's recorded evidence. It does not verify an exploit." },
  { id: "agent:fixer", agent: "fixer", label: "Fixer", severity: "context", detail: "Simulation agent: previews a finding turning green. It does not edit files or mark a finding as resolved." },
];

export interface SkyGraph {
  nodes: SkyNode[];
  links: { a: string; b: string }[];
  caption: string;
  demo?: boolean;
}

export interface ScanSnapshot {
  target: string;
  status: string;
  error: string;
  findings: { id: string; title: string; severity: string; status: string; evidence: string; locator: string }[];
}

export function reportGraph(scan: ScanSnapshot): SkyGraph {
  const findings = scan.error ? [] : scan.findings.filter(finding => finding.status === "done");
  return {
    nodes: [
      { id: "target", label: scan.target, severity: "none", detail: "The application checked in this saved scan." },
      ...findings.map(finding => ({
        id: "finding:" + finding.id, findingId: finding.id, label: finding.title,
        severity: finding.severity, detail: (finding.locator ? finding.locator + "\n" : "") + (finding.evidence || "No evidence recorded yet."),
      })),
    ],
    // Polaris records findings, not proven attack chains. Links identify their target.
    links: findings.map(finding => ({ a: "target", b: "finding:" + finding.id })),
    caption: scan.error ? "The report could not be loaded. Open Findings for details."
      : scan.status === "failed" ? "The scan could not finish. Open Agent activity for details."
      : `${findings.length} saved findings. Connections show the scan target.`,
  };
}

const demoFindings = [
  ["app.js.map", "high", "Demo: a public source map reveals the application's source files."],
  ["Missing CSP", "medium", "Demo: the website does not return a Content-Security-Policy header."],
  ["Public /debug route", "high", "Demo: a debug page responds without an account."],
  ["Secret in client.js", "breach", "Demo: a credential pattern appears in a public JavaScript bundle. This is sample data."],
];

export const coverageGraph: SkyGraph = {
  demo: true,
  nodes: [
    { id: "target", label: "demo.example.com", severity: "none", detail: "An illustrative application. These are sample findings, not a live scan." },
    ...demoFindings.map(([label, severity, detail], index) => ({ id: `demo:${index}`, label, detail, severity })),
  ],
  links: demoFindings.map((_, index) => ({ a: "target", b: `demo:${index}` })),
  caption: "Demo constellation. Sample findings only.",
};
