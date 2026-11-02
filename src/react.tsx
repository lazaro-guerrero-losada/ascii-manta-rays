"use client";

import { useEffect, useRef } from "react";
import { MantaEngine } from "./engine";
import type { MantaSpec } from "./species";

/** Glyphs come from the canvas's font-family, so give it (or a parent) a monospace font. */
export function AsciiMantaRays({ className, mantas }: { className?: string; mantas?: MantaSpec[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new MantaEngine(canvas, mantas);
    return () => engine.destroy();
    // The roster is fixed for the life of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`ascii-manta-rays ${className ?? ""}`} />;
}
