import { AttackChain, Finding, ScanState, Severity } from "@/types/scan";
import { inferAttackChainFromFindings } from "@/components/attack-chain-graph";

// ── Data model ───────────────────────────────────────────────────────────────
//
// Every finding is a star. The target is the anchor star in the middle.
// Attack chain edges are the bright lines (the constellation). Findings that
// share a component get a faint line so related issues cluster together.

export type StarKind = "target" | "finding" | "waypoint";

export interface Link {
  a: string;
  b: string;
  kind: "path" | "entry" | "component";
  label: string;
}

export interface Graph {
  stars: { id: string; kind: StarKind; label: string; severity: Severity | "none"; finding?: Finding }[];
  links: Link[];
  chainSource: "agent" | "inferred" | "none";
}

export const SEVERITY_COLOR: Record<Severity | "none", string> = {
  critical: "#f87171",
  high: "#fb923c",
  medium: "#fbbf24",
  low: "#60a5fa",
  info: "#94a3b8",
  none: "#e2e8f0",
};

export const SEVERITY_RADIUS: Record<Severity | "none", number> = {
  critical: 12,
  high: 10,
  medium: 8,
  low: 6.5,
  info: 5,
  none: 14,
};

export function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function findingKey(f: Finding) {
  return `${f.title.trim().toLowerCase()}|${f.component.trim().toLowerCase()}|${f.tool.trim().toLowerCase()}`;
}

export function hostLabel(target: string) {
  try {
    const u = new URL(target);
    return u.host + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return target;
  }
}

export function buildGraph(scan: ScanState): Graph {
  const seen = new Set<string>();
  const findings = scan.findings.filter((f) => {
    const k = findingKey(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const stars: Graph["stars"] = [
    { id: "target", kind: "target", label: hostLabel(scan.target || "target"), severity: "none" },
  ];
  const starIdByTitle = new Map<string, string>();
  findings.forEach((f, i) => {
    const id = `f_${i}_${findingKey(f)}`;
    stars.push({ id, kind: "finding", label: f.title, severity: f.severity ?? "info", finding: f });
    starIdByTitle.set(f.title.trim().toLowerCase(), id);
  });

  const provided: AttackChain | undefined = scan.attack_chain;
  let chain: AttackChain | null = provided && provided.nodes.length ? provided : null;
  let chainSource: Graph["chainSource"] = chain ? "agent" : "none";
  if (!chain) {
    chain = inferAttackChainFromFindings(scan);
    if (chain) chainSource = "inferred";
  }

  const links: Link[] = [];
  const linked = new Set<string>();
  const chainStarId = new Map<string, string>();

  if (chain) {
    for (const node of chain.nodes) {
      const ref = (node.finding_ref || node.label || "").trim().toLowerCase();
      let sid = starIdByTitle.get(ref);
      if (!sid) {
        // Loose match: finding title starts with the ref or vice versa.
        for (const [title, id] of starIdByTitle) {
          if (ref && (title.startsWith(ref) || ref.startsWith(title))) {
            sid = id;
            break;
          }
        }
      }
      if (!sid) {
        sid = `w_${node.id}`;
        stars.push({ id: sid, kind: "waypoint", label: node.label, severity: "none" });
      }
      chainStarId.set(node.id, sid);
    }

    const hasIncoming = new Set(chain.edges.map((e) => e.to_id));
    for (const e of chain.edges) {
      const a = chainStarId.get(e.from_id);
      const b = chainStarId.get(e.to_id);
      if (!a || !b || a === b) continue;
      links.push({ a, b, kind: "path", label: e.label || "enables" });
      linked.add(a);
      linked.add(b);
    }
    // Chain roots (entry points) hang off the target.
    for (const node of chain.nodes) {
      if (hasIncoming.has(node.id)) continue;
      const sid = chainStarId.get(node.id);
      if (!sid) continue;
      links.push({ a: "target", b: sid, kind: "entry", label: "entry point" });
      linked.add(sid);
    }
  }

  // Faint lines between findings in the same component.
  const byComponent = new Map<string, string[]>();
  findings.forEach((f, i) => {
    const comp = f.component.trim().toLowerCase();
    if (!comp) return;
    const id = `f_${i}_${findingKey(f)}`;
    (byComponent.get(comp) ?? byComponent.set(comp, []).get(comp)!).push(id);
  });
  for (const ids of byComponent.values()) {
    for (let i = 1; i < ids.length; i++) {
      links.push({ a: ids[i - 1], b: ids[i], kind: "component", label: "same component" });
    }
  }

  // Anything still floating alone gets a thread to the target.
  for (const s of stars) {
    if (s.kind === "target" || linked.has(s.id)) continue;
    const inComponentLink = links.some((l) => l.kind === "component" && (l.a === s.id || l.b === s.id));
    if (!inComponentLink) links.push({ a: "target", b: s.id, kind: "entry", label: "" });
  }

  return { stars, links, chainSource };
}

