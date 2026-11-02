import { MantaEngine, MANTA_KINDS, type MantaSpec } from "./src";

declare global {
  interface Window {
    __MANTA_DEMO__?: boolean;
  }
}

if (!window.__MANTA_DEMO__) {
  window.__MANTA_DEMO__ = true;
  const kinds = new URLSearchParams(location.search).get("mantas")?.split(",").filter(Boolean);
  const mantas: MantaSpec[] | undefined = kinds?.map((kind, i) => ({
    kind: MANTA_KINDS.includes(kind) ? kind : "giant_manta",
    size: 1 - i * 0.1,
  }));

  const canvas = document.querySelector<HTMLCanvasElement>("canvas");
  if (canvas) {
    new MantaEngine(canvas, mantas);
  }
}
