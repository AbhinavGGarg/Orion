import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import ParticleBackground from "@/components/ui/particle-background";

function subscribeMotion(callback: () => void) {
  document.addEventListener("polaris:motion", callback);
  return () => document.removeEventListener("polaris:motion", callback);
}

function PolarisBackground() {
  const paused = useSyncExternalStore(subscribeMotion, () => document.documentElement.dataset.motion === "off");
  return <ParticleBackground paused={paused} />;
}

const mount = document.createElement("div");
mount.id = "polaris-background";
document.body.append(mount);
createRoot(mount).render(<PolarisBackground />);
