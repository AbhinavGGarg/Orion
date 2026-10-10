"use client";

import { motion, useReducedMotion } from "motion/react";
import { AmbientCursorTrails } from "@/components/ambient-cursor-trails";
import { GridLayer } from "@/components/grid-layer";
import { ParticleLayer } from "@/components/particle-layer";

interface AnimatedBackgroundProps {
  particles?: boolean;
  grid?: boolean;
  trails?: boolean;
}

export function AnimatedBackground({
  particles = true,
  grid = true,
  trails = true,
}: AnimatedBackgroundProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <motion.div
        className="absolute -inset-[16%] bg-[linear-gradient(128deg,#01040b_0%,#061022_28%,#0d2441_56%,#0a1430_80%,#030713_100%)]"
        animate={
          prefersReducedMotion
            ? undefined
            : {
                backgroundPosition: [
                  "0% 50%",
                  "28% 58%",
                  "64% 40%",
                  "100% 50%",
                  "0% 50%",
                ],
              }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: 52,
                ease: "easeInOut",
                repeat: Number.POSITIVE_INFINITY,
              }
        }
        style={{ backgroundSize: "180% 180%" }}
      />

      <motion.div
        className="absolute -left-24 -top-24 h-[34rem] w-[34rem] rounded-full bg-cyan-400/20 blur-[140px]"
        animate={prefersReducedMotion ? undefined : { opacity: [0.42, 0.62, 0.46, 0.42] }}
        transition={
          prefersReducedMotion
            ? undefined
            : { duration: 13, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
        }
      />
      <motion.div
        className="absolute -right-28 bottom-[-8rem] h-[36rem] w-[36rem] rounded-full bg-indigo-500/22 blur-[150px]"
        animate={prefersReducedMotion ? undefined : { opacity: [0.4, 0.64, 0.44, 0.4] }}
        transition={
          prefersReducedMotion
            ? undefined
            : { duration: 15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 1.2 }
        }
      />
      <motion.div
        className="absolute left-[46%] top-[30%] h-[24rem] w-[24rem] -translate-x-1/2 rounded-full bg-blue-400/12 blur-[120px]"
        animate={prefersReducedMotion ? undefined : { opacity: [0.22, 0.38, 0.24, 0.22] }}
        transition={
          prefersReducedMotion
            ? undefined
            : { duration: 17, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 2.5 }
        }
      />

      <div className="fine-texture-overlay absolute inset-0" />
      <div className="grain-overlay absolute inset-0" />
      {grid ? <GridLayer /> : null}
      {particles ? <ParticleLayer /> : null}
      {trails ? <AmbientCursorTrails /> : null}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1326]/22 via-[#081225]/42 to-[#030610]/82" />
    </div>
  );
}
