export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ScanStatus = "pending" | "running" | "complete" | "failed";

export interface Finding {
  agent: string;
  tool: string;
  severity: Severity;
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  component: string;
}

export interface ChainNode {
  id: string;
  label: string;
  type: string; // initial_access | credential_access | lateral_movement | exfiltration | impact | service
  finding_ref: string;
}

export interface ChainEdge {
  from_id: string;
  to_id: string;
  label: string;
  justification: string;
}

export interface AttackChain {
  nodes: ChainNode[];
  edges: ChainEdge[];
  narrative: string;
  mermaid: string;
}

export interface PortInfo {
  port: number;
  protocol: string;
  service: string;
  version: string;
  risk: "info" | "low" | "medium" | "high";
}

export interface ScanState {
  scan_id: string;
  target: string;
  resolved_target: string;
  source_repo_url: string;
  target_type: string;
  architecture_summary: string;
  threat_model: string;
  status: ScanStatus;
  current_agent: string;
  agents_plan: string[];
  attack_chain: AttackChain;
  findings: Finding[];
  ports: PortInfo[];
  started_at: number;
  agent_timings: Record<string, number>;
  log: string[];
  llm_log: string[];
  report: string;
}
