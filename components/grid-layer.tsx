"use client";

export function GridLayer() {
  return (
    <div className="absolute inset-0">
      <div className="grid-motion-layer absolute inset-0" />
      <div className="network-pulse-layer absolute inset-0" />
      <div className="scan-sweep-layer absolute inset-0" />
    </div>
  );
}
