import { clamp, hash3 } from "./math";
import {
  MANTA_NODES,
  MANTA_SHAPES,
  MANTA_KINDS,
  MANTA_TINTS,
  type MantaShape,
} from "./species";
import type { MantaAgent, RemoraAgent, MantaWorld } from "./world";

export const ALPHA_LEVELS = 6;
export const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
export const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
export const SKIN_RAMP = ":;t%SX8#@";
export const FIN_GLYPHS = "%;tS:";
export const RIDGE_GLYPHS = "@8%";
export const EDGE_HEAVY = ":;";
export const EDGE_LIGHT = ".',`";
export const MARK_GLYPHS = "#%@";

export const FLAG_BODY = 1;
export const FLAG_EDGE = 2;
export const FLAG_FIN = 3;
export const FLAG_RIDGE = 4;
export const FLAG_EYE = 5;
export const FLAG_MARK = 6;
export const FLAG_WHITE_PATCH = 7;
export const FLAG_WHITE_SPOT = 8;

export const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

export class BaseAsciiRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bg: HTMLCanvasElement;
  kinds: string[];
  tints: Record<string, [number, number, number]>;
  dpr = 1;
  width = 0;
  height = 0;
  cols = 0;
  rows = 0;
  cw = 8;
  ch = 12;
  font = "";
  cellFlag: Uint8Array = new Uint8Array(0);
  cellShade: Float32Array = new Float32Array(0);
  cellKey: Uint32Array = new Uint32Array(0);
  cellDepth: Float32Array = new Float32Array(0);
  cellKind: Uint8Array = new Uint8Array(0);
  ambientStamp: Uint32Array = new Uint32Array(0);
  ambientBuckets: number[][] = [];
  ambientGlyph = ".";
  ambientGlyphs: string[] | null = null;
  hitFlag = 0;
  hitShade = 0;
  hitDist = 0;
  hitS = 0;
  hitV = 0;

  constructor(canvas: HTMLCanvasElement, kinds: string[], tints: Record<string, [number, number, number]>) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.kinds = kinds;
    this.tints = tints;
    for (let i = 0; i < AMBIENT_ALPHAS.length; i++) this.ambientBuckets.push([]);
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    const baseCw = clamp(Math.round(width / 135), 7, 10);
    this.cw = baseCw;
    this.ch = Math.round(baseCw * 1.5);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);

    const n = this.cols * this.rows;
    if (this.cellFlag.length < n) {
      this.cellFlag = new Uint8Array(n);
      this.cellShade = new Float32Array(n);
      this.cellKey = new Uint32Array(n);
      this.cellDepth = new Float32Array(n);
      this.cellKind = new Uint8Array(n);
      this.ambientStamp = new Uint32Array(n);
    }

    const fs = Math.round(this.ch * 0.95);
    this.font = `600 ${fs}px "Geist Mono", "SF Mono", Monaco, Consolas, monospace`;

    this.renderBackgroundGrid();
  }

  renderBackgroundGrid() {
    const { bg, width, height, dpr, cw, ch, cols, rows } = this;
    bg.width = Math.round(width * dpr);
    bg.height = Math.round(height * dpr);
    const bctx = bg.getContext("2d")!;
    bctx.scale(dpr, dpr);
    bctx.fillStyle = "#fafbfe";
    bctx.fillRect(0, 0, width, height);

    bctx.font = this.font;
    bctx.textAlign = "center";
    bctx.textBaseline = "middle";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw / 2;
        const y = r * ch + ch / 2 + 1;
        const h = hash3(c, r, 101);
        if (h < 0.04) {
          bctx.fillStyle = "rgba(148, 163, 184, 0.40)";
          bctx.fillText("·", x, y);
        } else if (h < 0.09) {
          bctx.fillStyle = "rgba(203, 213, 225, 0.35)";
          bctx.fillText(".", x, y);
        }
      }
    }
  }

  cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + c;
  }
}


export class MantaRenderer extends BaseAsciiRenderer {
    constructor(canvas) {
      super(canvas, MANTA_KINDS, MANTA_TINTS);
      this.ambientGlyph = "-";
      this.spine = new Float32Array(MANTA_NODES * 2);
      this.arc = new Float32Array(MANTA_NODES);
      this.arcTotal = 1;
      this.discArcTotal = 1;
      this.curManta = null;
      this.curShape = MANTA_SHAPES.giant_manta;
      this.wingSpanLeft = 0;
      this.wingSpanRight = 0;
    }

    render(world, dt) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;

      this.consumeEvents(world);
      this.rasterizeMantas(world.mantas, t);
      this.depositWake(world);
      this.diffuse(dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.markAmbient(world.fish);
      this.drawDots();

      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      this.drawHeat();
      this.drawAmbient();
      this.drawCells(t);
    }

    depositWake(world) {
      const { energy } = this;
      for (const f of world.fish) {
        const i = this.cellIndex(f.x, f.y);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.01 + f.alarm * 0.025);
      }
      for (const m of world.mantas) {
        for (let k = MANTA_NODES - 7; k < MANTA_NODES; k++) {
          const i = this.cellIndex(m.nodes[k * 2], m.nodes[k * 2 + 1]);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.045);
        }
      }
      if (world.pointer.active) {
        this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
      }
    }

    sampleManta(px, py) {
      const { spine, arc, curManta: m, curShape: shape } = this;
      const L = this.arcTotal;
      const discNodes = shape.discNodes || 10;

      // Smooth Disc Coordinate Frame from head (node 0) to pelvic tail base (node discNodes - 1)
      const hx = spine[0];
      const hy = spine[1];
      const bx = spine[(discNodes - 1) * 2];
      const by = spine[(discNodes - 1) * 2 + 1];
      const dx = bx - hx;
      const dy = by - hy;
      const discLen = Math.hypot(dx, dy) || 1;
      const ux = dx / discLen;
      const uy = dy / discLen;
      const nx = -uy;
      const ny = ux;

      const midIdx = Math.floor(discNodes / 2);
      const midV = (spine[midIdx * 2] - hx) * nx + (spine[midIdx * 2 + 1] - hy) * ny;

      const relX = px - hx;
      const relY = py - hy;
      const u = relX * ux + relY * uy;
      const sd = u / discLen; // 0 at head/mouth rim, < 0 in front of head, 1 at pelvic base of tail
      const spineCurve = 4 * clamp(sd, 0, 1) * (1 - clamp(sd, 0, 1)) * midV;
      const v = relX * nx + relY * ny - spineCurve;
      const a = Math.abs(v);
      const discSign = v >= 0 ? 1 : -1;

      this.hitDist = Math.hypot(u - clamp(u, -0.28 * discLen, discLen), a);
      this.hitS = clamp((sd + 0.25) * 0.40, 0, 1);
      this.hitV = v;

      // 1. MANTA RAY ICONIC CEPHALIC HORNS & WIDE CAVERNOUS MOUTH
      // Two long, pronounced paddle/horn lobes projecting far forward on either side of the wide open mouth!
      if (shape.cephalic && sd >= -0.28 && sd < 0.28) {
        const hornForward = shape.hornLen || 0.23; // Projects far in front of sd = 0!
        // As sd goes from +0.22 (shoulder base) to -hornForward (horn tip), the horns curve slightly inward like (  )
        const sHorn = clamp((0.22 - sd) / (0.22 + hornForward), 0, 1); // 0 at base, 1 at forward tip
        const hornCenter = L * (0.136 - 0.026 * Math.sin(sHorn * Math.PI * 0.88));
        const hornHalfW = L * 0.056 * (1 - 0.26 * Math.pow(sHorn, 1.4));
        const distFromHornAxis = Math.abs(a - hornCenter);

        if (sd >= -hornForward && sd <= 0.22 && distFromHornAxis <= hornHalfW) {
          const acrossHorn = distFromHornAxis / (hornHalfW || 1);
          // Rounded paddle tip at the front of the horn
          const tipEnd = -hornForward + 0.038 * acrossHorn * acrossHorn;
          if (sd >= tipEnd) {
            if (sd > 0.04 && sd < 0.14 && a > hornCenter + hornHalfW * 0.32) {
              // Lateral eyes on the outer base of the cephalic horns
              this.hitFlag = FLAG_EYE;
              this.hitShade = 0;
            } else {
              // Solid body-colored cephalic horns (no white in the mouth zone!)
              this.hitFlag = FLAG_BODY;
              this.hitShade = 0.74 - 0.18 * acrossHorn;
            }
            return true;
          }
        }
      }

      // 2. SPOTTED EAGLE RAY PROMINENT DUCK-BILL SNOUT
      if (shape.duckbill && sd >= -0.16 && sd < 0.22) {
        const sSnout = clamp((sd + 0.16) / 0.38, 0, 1); // 0 at snout tip, 1 at neck
        // Rounded duck-bill lobe that widens, then indents slightly at the neck before the wings
        const snoutW = L * 0.088 * Math.sin(Math.pow(sSnout, 0.65) * Math.PI * 0.88);
        if (a <= snoutW) {
          if (sd > 0.05 && sd < 0.13 && a > snoutW * 0.68) {
            this.hitFlag = FLAG_EYE;
            this.hitShade = 0;
          } else {
            this.hitFlag = a > snoutW * 0.78 ? FLAG_FIN : FLAG_BODY;
            this.hitShade = 0.66 - 0.2 * (a / (snoutW || 1));
          }
          return true;
        }
      }

      // 3. ROUNDED SAUCER DISC (Leopard Ray / Round Fantail Stingray)
      const baseSpan = discSign > 0 ? this.wingSpanRight : this.wingSpanLeft;
      if (shape.roundedDisc) {
        const rRaw = a / (baseSpan || 1);
        if (rRaw <= 1.05 && sd >= -0.04 && sd <= 1.04) {
          // Travelling ruffled wave around the circular stingray margin
          const ruffle = 0.035 * Math.sin(m.phase * 1.4 - sd * 4.8) * smoothstep(0.3, 0.9, rRaw);
          const curSpan = baseSpan * (1 + ruffle);
          const r = a / (curSpan || 1);
          if (r <= 1.0) {
            // Smooth oval/circular saucer boundary with slight rostral point at front
            const halfChord = 0.50 * Math.sqrt(Math.max(0, 1 - Math.pow(r, 1.85)));
            const rostralTip = r < 0.18 ? 0.045 * (1 - r / 0.18) : 0;
            const sdFront = 0.50 - halfChord - rostralTip;
            const sdBack = 0.50 + halfChord * 0.98;

            if (sd >= sdFront && sd <= sdBack) {
              const radialDist = Math.hypot((sd - 0.50) / 0.50, r);
              const flapSlope = Math.cos(m.phase * 1.4 - sd * 4.2 - r * 1.5);
              let shade = 0.62 - radialDist * 0.18 + flapSlope * 0.16 * r;
              let flag = FLAG_BODY;

              // Eyes & spiracles set back on top of the rounded disc
              const dEye = Math.hypot((sd - 0.24) * 4.2, (a / (L * 0.42) - 0.16) * 4.5);
              if (dEye < 0.20) {
                flag = FLAG_EYE;
                shade = 0;
              } else if (r < 0.045 && sd > 0.28 && sd < 0.92) {
                flag = FLAG_RIDGE;
                shade = 0.95;
              } else if (radialDist > 0.86) {
                flag = FLAG_FIN;
                shade = 0.38;
              } else {
                // Leopard rosette rings: dark core surrounded by a ring of bright white ASCII letter infills!
                const cellU = sd * 8.5;
                const cellV = v / (L * 0.048);
                const gu = Math.round(cellU);
                const gv = Math.round(cellV);
                const jx = gu + (hash3(gu, gv, m.id) - 0.5) * 0.36;
                const jy = gv + (hash3(gu, gv, m.id + 7) - 0.5) * 0.36;
                const dRosette = Math.hypot(cellU - jx, cellV - jy);
                if (dRosette <= 0.18) {
                  flag = FLAG_RIDGE;
                  shade = 0.95;
                } else if (dRosette < 0.49 && hash3(gu, gv, m.id + 19) > 0.12) {
                  flag = FLAG_WHITE_SPOT;
                  shade = 0.92;
                }
              }

              this.hitFlag = flag;
              this.hitShade = clamp(shade, 0.1, 0.98);
              return true;
            }
          }
        }
      } else {
        // 4. SWEPT FALCATE / CURVED PECTORAL WINGS (Giant Manta, Reef Manta, Spotted Eagle Ray)
        const rRaw = a / (baseSpan || 1);
        if (rRaw <= 1.06 && sd >= 0.04 && sd <= 1.04) {
          const flapPhase = m.phase - sd * 2.2 - rRaw * 1.6;
          const flap = Math.sin(flapPhase);
          const flapSlope = Math.cos(flapPhase);
          const spanScale = 1 - 0.10 * flap * flap * smoothstep(0.15, 0.9, rRaw);
          const curSpan = baseSpan * spanScale;
          const r = a / (curSpan || 1);

          if (r <= 1.0) {
            const tipShift = flap * 0.05 * r * r;
            // For cephalic mantas, the center mouth is deeply recessed between the two cephalic horns!
            const mouthRecess = shape.cephalic && a < L * 0.096
              ? 0.135 * Math.cos(((a / (L * 0.096)) * Math.PI) / 2)
              : 0;
            const startFront = (shape.cephalic ? 0.075 : 0.11) + mouthRecess;
            const tipS = (shape.curvedWings ? 0.64 : 0.70) + tipShift;
            const leadPow = shape.curvedWings ? 1.65 : 1.32;
            const sdFront = startFront + (tipS - startFront) * Math.pow(r, leadPow);
            const falcateArch = Math.sin(r * Math.PI) * (shape.curvedWings ? 0.10 : 0.15);
            const sdBack = 0.98 - (0.98 - (tipS + (shape.curvedWings ? 0.08 : 0.045))) * Math.pow(r, 0.92) - falcateArch;

            if (sd >= sdFront && sd <= sdBack) {
              const chord = Math.max(0.04, sdBack - sdFront);
              const sc = (sd - sdFront) / chord;
              const facing = (nx * -0.6 + ny * -0.8) * discSign * r;

              let shade = 0.62 - r * 0.10 + flapSlope * 0.18 * smoothstep(0.12, 0.85, r) + facing * 0.16;
              let flag = FLAG_BODY;

              if (r < 0.042 && sd > 0.16 && sd < 0.92) {
                flag = FLAG_RIDGE;
                shade = 0.96;
              } else if (
                shape.pattern === "manta_patches" &&
                sd > 0.24 &&
                sd < 0.48 &&
                r > 0.08 &&
                r < 0.36 &&
                sc > 0.20 &&
                sc < 0.70
              ) {
                // Giant Manta subtle lighter slate-gray shoulder shading (no stark white mouth/head zone!)
                flag = FLAG_BODY;
                shade = 0.32 + 0.14 * (r / 0.36);
              } else if (
                shape.pattern === "reef_chevron" &&
                ((sd > 0.24 && sd < 0.50 && r > 0.06 && r < 0.36 && Math.abs(sd - (0.25 + r * 0.58)) < 0.085) ||
                  (r > 0.62 && r < 0.78 && sc > 0.22 && sc < 0.68))
              ) {
                // Reef Manta lighter cerulean dorsal V-chevron shading
                flag = FLAG_BODY;
                shade = 0.28;
              } else if (
                shape.pattern === "white_dots" &&
                r < 0.88 &&
                sc > 0.09 &&
                sc < 0.91 &&
                sd > 0.11
              ) {
                // Spotted Eagle Ray: full deep-blue skin spotted with bright white ASCII dots!
                const cellU = sd * 10.5;
                const cellV = v / (L * 0.040);
                const gu = Math.round(cellU);
                const gv = Math.round(cellV);
                const jx = gu + (hash3(gu, gv, m.id) - 0.5) * 0.32;
                const jy = gv + (hash3(gu, gv, m.id + 5) - 0.5) * 0.32;
                const dSpot = Math.hypot(cellU - jx, cellV - jy);
                if (dSpot < 0.47 && hash3(gu, gv, m.id + 13) > 0.08) {
                  flag = FLAG_WHITE_SPOT;
                  shade = 0.92;
                }
              } else if (r > 0.84 || sc > 0.86) {
                flag = FLAG_FIN;
                shade = clamp(0.38 + flapSlope * 0.14, 0.15, 0.75);
              } else if (sc < 0.10) {
                // Crisp mouth & wing leading edge
                shade = Math.max(shade, 0.76);
              }

              this.hitFlag = flag;
              this.hitShade = clamp(shade, 0.1, 0.98);
              return true;
            }
          }
        }
      }

      // 5. Whip Tail (nodes discNodes - 2 .. MANTA_NODES - 1)
      let bestTail = Infinity;
      let tailS = 0;
      let tailSign = 1;
      const tailLen = Math.max(1, L - arc[discNodes - 2]);
      for (let k = discNodes - 2; k < MANTA_NODES - 1; k++) {
        const ax = spine[k * 2];
        const ay = spine[k * 2 + 1];
        const bx = spine[(k + 1) * 2];
        const by = spine[(k + 1) * 2 + 1];
        const abx = bx - ax;
        const aby = by - ay;
        const ab2 = abx * abx + aby * aby || 1e-6;
        const apx = px - ax;
        const apy = py - ay;
        const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
        const qx = ax + abx * t;
        const qy = ay + aby * t;
        const d2 = (px - qx) ** 2 + (py - qy) ** 2;
        if (d2 < bestTail) {
          bestTail = d2;
          tailS = clamp((arc[k] - arc[discNodes - 2] + Math.sqrt(ab2) * t) / tailLen, 0, 1);
          tailSign = abx * apy - aby * apx >= 0 ? 1 : -1;
        }
      }

      const dTail = Math.sqrt(bestTail);
      if (dTail < this.hitDist) this.hitDist = dTail;
      const tailW = L * 0.020 * Math.pow(1 - tailS, 1.15) + 1.5;
      if (dTail <= tailW) {
        this.hitDist = 0;
        this.hitS = 0.45 + tailS * 0.55;
        this.hitV = dTail * tailSign;
        this.hitFlag = tailS < 0.32 && dTail < tailW * 0.5 ? FLAG_RIDGE : FLAG_FIN;
        this.hitShade = 0.72 * (1 - tailS * 0.55);
        return true;
      }

      return false;
    }

    rasterizeMantas(mantas, t) {
      const { cellFlag, cellShade, cellKey, cellDepth, cellKind, spine, arc, cw, ch, cols, rows } = this;
      cellFlag.fill(0);

      for (const m of mantas) {
        this.curManta = m;
        this.curShape = MANTA_SHAPES[m.kind] || MANTA_SHAPES.giant_manta;
        const kindIndex = Math.max(0, MANTA_KINDS.indexOf(m.kind));
        const L = m.length;
        const N = MANTA_NODES;
        const n = m.nodes;

        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          const a = Math.max(0, k - 1);
          const b = Math.min(N - 1, k + 1);
          let tx = n[a * 2] - n[b * 2];
          let ty = n[a * 2 + 1] - n[b * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const amp = L * 0.028 * Math.pow(s, 2.2);
          const off = amp * Math.sin(m.phase - s * 4.5);
          spine[k * 2] = n[k * 2] - ty * off;
          spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
        }

        arc[0] = 0;
        for (let k = 1; k < N; k++) {
          arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
        }
        this.arcTotal = arc[N - 1] || 1;
        const discNodes = this.curShape.discNodes || 10;
        this.discArcTotal = arc[discNodes - 1] || 1;

        const bank = clamp(m.turn * 0.45, -0.32, 0.32);
        const span = L * this.curShape.wingSpan;
        this.wingSpanRight = span * (1 - bank * 0.65);
        this.wingSpanLeft = span * (1 + bank * 0.65);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let k = 0; k < N; k++) {
          minX = Math.min(minX, spine[k * 2]);
          maxX = Math.max(maxX, spine[k * 2]);
          minY = Math.min(minY, spine[k * 2 + 1]);
          maxY = Math.max(maxY, spine[k * 2 + 1]);
        }
        const reach = Math.max(this.wingSpanLeft, this.wingSpanRight) + L * 0.14 + 18;
        const c0 = Math.max(0, Math.floor((minX - reach) / cw));
        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
        const r0 = Math.max(0, Math.floor((minY - reach) / ch));
        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
        if (c0 > c1 || r0 > r1) continue;

        const skipBeyond = reach + Math.hypot(cw, ch);

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = c * cw;
            const y = r * ch;
            const centerHit = this.sampleManta(x + cw / 2, y + ch / 2);
            if (!centerHit && this.hitDist > skipBeyond) continue;
            const flag = this.hitFlag;
            const shade = this.hitShade;
            const s = this.hitS;
            const v = this.hitV;

            let hits = centerHit ? 1 : 0;
            for (let k = 0; k < SUBSAMPLES.length; k += 2) {
              if (this.sampleManta(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) hits++;
            }
            if (hits === 0) continue;
            const coverage = hits / 5;

            const i = r * cols + c;
            const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), m.id) * 4294967295) >>> 0;
            cellKey[i] = key;
            cellDepth[i] = m.depth;
            cellKind[i] = kindIndex;

            if (centerHit && coverage >= 0.6) {
              cellFlag[i] = flag;
              const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.05;
              cellShade[i] = clamp(shade + flicker, 0, 1);
            } else {
              cellFlag[i] = FLAG_EDGE;
              cellShade[i] = coverage;
            }
          }
        }
      }
    }

    drawCells(t) {
      const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind, kinds } = this;
      const SPOT_GLYPHS = "@Oo*8#0";
      const WHITE_PATCH_GLYPHS = ":;t%S";
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const flag = cellFlag[i];
        if (!flag) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const x = col * cw;
        const y = row * ch;
        const key = cellKey[i];
        const shade = cellShade[i];
        const dim = 0.84 + 0.16 * cellDepth[i];
        const kindName = kinds[cellKind[i]] || "giant_manta";
        const shape = MANTA_SHAPES[kindName] || MANTA_SHAPES.giant_manta;
        const isBrownLeopard = shape.palette === "brown_black";

        const tick = Math.floor(t * 2.4 + (key % 997) / 97);
        const roll = hash3(key, tick, 7);

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          if (roll < 0.05) {
            ctx.fillStyle = ACCENTS[key % ACCENTS.length];
          } else if (isBrownLeopard) {
            ctx.fillStyle = "rgba(92, 64, 36, 0.78)";
          } else if (shape.palette === "slate_gray") {
            ctx.fillStyle = "rgba(71, 85, 105, 0.78)";
          } else {
            ctx.fillStyle = "rgba(30, 58, 102, 0.78)";
          }
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        if (flag === FLAG_WHITE_PATCH) {
          // Bright crisp white dorsal shoulder patches (Giant Manta) & dorsal V-chevron (Reef Manta)
          const wLevel = Math.round((246 - shade * 28) * (0.93 + 0.07 * cellDepth[i]));
          ctx.fillStyle = `rgb(${wLevel - 3}, ${wLevel}, ${Math.min(255, wLevel + 4)})`;
          ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
          const glyph = WHITE_PATCH_GLYPHS[(key >>> 6) % WHITE_PATCH_GLYPHS.length];
          ctx.fillStyle = shape.palette === "slate_gray" ? "#334155" : "#1e3a5f";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        if (flag === FLAG_WHITE_SPOT) {
          const gx = x + cw / 2;
          const gy = y + ch / 2 + 1;
          const glyph = SPOT_GLYPHS[(key >>> 5) % SPOT_GLYPHS.length];

          if (isBrownLeopard) {
            // Leopard Ray: charcoal-black leopard rosette rings on warm sandy-brown skin!
            const blk = Math.round(28 * dim);
            ctx.fillStyle = `rgb(${blk + 6},${blk + 2},${blk})`;
            ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
            ctx.fillStyle = "#e2b887";
            ctx.fillText(glyph, gx, gy);
            continue;
          }

          // Spotted Eagle Ray: full deep-blue dorsal skin cell with pure BRIGHT WHITE (#ffffff) ASCII letter infill!
          const [tr, tg, tb] = shape.tint;
          const base = 178 * dim;
          const r = Math.min(255, Math.round(base * tr));
          const g = Math.min(255, Math.round(base * tg));
          const b = Math.min(255, Math.round(base * tb));
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

          ctx.fillStyle = "#ffffff";
          ctx.fillText(glyph, gx - 0.35, gy);
          ctx.fillText(glyph, gx + 0.35, gy);
          continue;
        }

        // Species-specific dorsal shading for FLAG_BODY, FLAG_RIDGE, FLAG_FIN, FLAG_EYE
        const [tr, tg, tb] = shape.tint;
        let lum;
        let glyph;
        if (flag === FLAG_RIDGE) {
          lum = isBrownLeopard ? 52 : 110;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          lum = 44;
          glyph = "o";
        } else if (flag === FLAG_FIN) {
          lum = 228 - shade * 62;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          lum = 226 - shade * 86;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }

        lum *= dim;
        const r = Math.min(255, Math.round(lum * tr));
        const g = Math.min(255, Math.round(lum * tg));
        const b = Math.min(255, Math.round(lum * tb));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

        let glyphColor;
        if (flag === FLAG_EYE) {
          glyphColor = "#ffffff";
        } else if (roll < 0.025) {
          glyphColor = ACCENTS[key % ACCENTS.length];
        } else if (isBrownLeopard) {
          glyphColor = flag === FLAG_RIDGE
            ? "#d6a874"
            : `rgb(${Math.max(0, r - 48)},${Math.max(0, g - 38)},${Math.max(0, b - 24)})`;
        } else if (shape.palette === "slate_gray") {
          glyphColor = `rgb(${Math.min(255, r + 38)},${Math.min(255, g + 40)},${Math.min(255, b + 44)})`;
        } else if (flag === FLAG_RIDGE) {
          glyphColor = `rgb(${Math.min(255, r + 28)},${Math.min(255, g + 38)},${Math.min(255, b + 54)})`;
        } else {
          glyphColor = `rgb(${Math.min(255, r + 34)},${Math.min(255, g + 46)},${Math.min(255, b + 64)})`;
        }
        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

