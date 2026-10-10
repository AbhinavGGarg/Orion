"use client";

import { PortInfo, ScanState } from "@/types/scan";

const RISK_COLOR: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  high:   { bg: "#1a0000", border: "#ef4444", text: "#fca5a5", badge: "#ef4444" },
  medium: { bg: "#1a1000", border: "#f97316", text: "#fdba74", badge: "#f97316" },
  low:    { bg: "#071a0a", border: "#22c55e", text: "#86efac", badge: "#22c55e" },
  info:   { bg: "#111827", border: "#374151", text: "#9ca3af", badge: "#6b7280" },
};

const ROW_H  = 22;
const PAD_X  = 8;
const PAD_Y  = 6;
const PORT_W = 44;
const PROTO_W = 30;
const SVC_W  = 60;
const VER_W  = 110;
const BADGE_W = 44;
const GAP     = 6;

const COL_X = {
  port:    PAD_X,
  proto:   PAD_X + PORT_W + GAP,
  service: PAD_X + PORT_W + GAP + PROTO_W + GAP,
  version: PAD_X + PORT_W + GAP + PROTO_W + GAP + SVC_W + GAP,
  risk:    PAD_X + PORT_W + GAP + PROTO_W + GAP + SVC_W + GAP + VER_W + GAP,
};

const SVG_W = COL_X.risk + BADGE_W + PAD_X;
const HEADER_H = 22;

function riskLabel(risk: string) {
  return risk.toUpperCase();
}

export function NmapPortMap({ scan }: { scan: ScanState }) {
  const ports: PortInfo[] = scan.ports ?? [];

  if (ports.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-white/20 text-xs font-mono">
        {scan.status === "running" ? "Awaiting recon…" : "No open ports detected"}
      </div>
    );
  }

  const sorted = [...ports].sort((a, b) => a.port - b.port);
  const svgH = PAD_Y + HEADER_H + sorted.length * ROW_H + PAD_Y;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${SVG_W} ${svgH}`}
        width="100%"
        className="min-w-[360px]"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        {/* Column headers */}
        {[
          { x: COL_X.port,    label: "Port" },
          { x: COL_X.proto,   label: "Proto" },
          { x: COL_X.service, label: "Service" },
          { x: COL_X.version, label: "Version" },
          { x: COL_X.risk,    label: "Risk" },
        ].map(({ x, label }) => (
          <text key={label} x={x} y={PAD_Y + 11} fontSize="7" fill="#4b5563" fontWeight="600">
            {label.toUpperCase()}
          </text>
        ))}

        {/* Separator */}
        <line
          x1={PAD_X} y1={PAD_Y + HEADER_H}
          x2={SVG_W - PAD_X} y2={PAD_Y + HEADER_H}
          stroke="#1f2937" strokeWidth="1"
        />

        {/* Port rows */}
        {sorted.map((p, i) => {
          const y = PAD_Y + HEADER_H + i * ROW_H;
          const mid = y + ROW_H / 2;
          const c = RISK_COLOR[p.risk] ?? RISK_COLOR.info;

          return (
            <g key={`${p.port}-${p.protocol}`}>
              {/* Row background (alternating) */}
              {i % 2 === 0 && (
                <rect x={PAD_X - 4} y={y} width={SVG_W - PAD_X * 2 + 8} height={ROW_H} fill="#ffffff08" rx="3" />
              )}

              {/* Risk left-edge stripe */}
              <rect x={PAD_X - 4} y={y + 3} width="2.5" height={ROW_H - 6} rx="1.5" fill={c.badge} opacity="0.8" />

              {/* Port number */}
              <text x={COL_X.port + 5} y={mid} dominantBaseline="middle" fontSize="8.5" fontWeight="700" fill={c.text}>
                {p.port}
              </text>

              {/* Protocol badge */}
              <rect x={COL_X.proto} y={mid - 6} width={PROTO_W - 6} height="12" rx="3" fill={c.bg} stroke={c.border} strokeWidth="0.8" />
              <text x={COL_X.proto + (PROTO_W - 6) / 2} y={mid} dominantBaseline="middle" textAnchor="middle" fontSize="6.5" fill={c.text} fontWeight="600">
                {p.protocol.toUpperCase()}
              </text>

              {/* Service */}
              <text x={COL_X.service} y={mid} dominantBaseline="middle" fontSize="8" fill="#d1d5db">
                {p.service.length > 9 ? p.service.slice(0, 8) + "…" : p.service}
              </text>

              {/* Version */}
              <text x={COL_X.version} y={mid} dominantBaseline="middle" fontSize="7.5" fill="#6b7280">
                {p.version.length > 18 ? p.version.slice(0, 17) + "…" : p.version || "—"}
              </text>

              {/* Risk badge */}
              <rect x={COL_X.risk} y={mid - 6} width={BADGE_W} height="12" rx="3" fill={c.bg} stroke={c.border} strokeWidth="0.8" />
              <text x={COL_X.risk + BADGE_W / 2} y={mid} dominantBaseline="middle" textAnchor="middle" fontSize="6.5" fill={c.text} fontWeight="700">
                {riskLabel(p.risk)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
