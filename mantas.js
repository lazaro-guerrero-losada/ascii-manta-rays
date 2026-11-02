(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var exports = factory();
    root.MantaEngine = exports.MantaEngine;
    root.MantaWorld = exports.MantaWorld;
    root.MantaRenderer = exports.MantaRenderer;
    root.MANTA_SHAPES = exports.MANTA_SHAPES;
    root.MANTA_KINDS = exports.MANTA_KINDS;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function hash3(x, y, z) {
    let h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const K1 = 1 / 260;
  const K2 = 1 / 310;
  const K3 = 1 / 190;
  const CURRENT_SCALE = 3400;

  function flowCurrent(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // Exact same ASCII constants & palette as sharks.js
  const ALPHA_LEVELS = 6;
  const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
  const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  const SKIN_RAMP = ":;t%SX8#@";
  const FIN_GLYPHS = "%;tS:";
  const RIDGE_GLYPHS = "@8%";
  const EDGE_HEAVY = ":;";
  const EDGE_LIGHT = ".',`";
  const MARK_GLYPHS = "#%@";

  const FLAG_BODY = 1;
  const FLAG_EDGE = 2;
  const FLAG_FIN = 3;
  const FLAG_RIDGE = 4;
  const FLAG_EYE = 5;
  const FLAG_MARK = 6;
  const FLAG_WHITE_PATCH = 7;
  const FLAG_WHITE_SPOT = 8;

  const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  const STEP = 1 / 60;
  const MAX_STEPS = 4;

  // ── SHARED BASE ASCII RENDERER ───────────────────────────────────────────

  class BaseAsciiRenderer {
    constructor(canvas, kinds, tints) {
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.canvas = canvas;
      this.ctx = ctx;
      this.bg = document.createElement("canvas");
      this.kinds = kinds;
      this.tints = tints;

      this.dpr = 1;
      this.width = 0;
      this.height = 0;
      this.cw = 12;
      this.ch = 18;
      this.cols = 0;
      this.rows = 0;
      this.fontFamily = "ui-monospace, Menlo, monospace";

      this.energy = new Float32Array(0);
      this.energyTmp = new Float32Array(0);
      this.heat = new Float32Array(0);
      this.dotStyles = [];

      this.cellFlag = new Uint8Array(0);
      this.cellShade = new Float32Array(0);
      this.cellKey = new Uint32Array(0);
      this.cellDepth = new Float32Array(0);
      this.cellKind = new Uint8Array(0);

      this.ambientStamp = new Uint32Array(0);
      this.frameId = 0;
      this.ambientBuckets = AMBIENT_ALPHAS.map(() => []);
      this.ambientGlyph = "-";

      this.hitFlag = 0;
      this.hitShade = 0;
      this.hitS = 0;
      this.hitV = 0;
      this.hitDist = 0;

      for (let l = 0; l < ALPHA_LEVELS; l++) {
        const a = (0.35 * (l + 1)) / ALPHA_LEVELS;
        this.dotStyles.push(`rgba(14, 165, 233, ${a.toFixed(3)})`);
      }
    }

    get cellWidth() { return this.cw; }
    get cellHeight() { return this.ch; }

    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }

    resize(width, height, dpr) {
      const prevCols = this.cols;
      const prevRows = this.rows;
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;

      const n = this.cols * this.rows;
      if (this.cols !== prevCols || this.rows !== prevRows) {
        this.energy = new Float32Array(n);
        this.energyTmp = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.cellFlag = new Uint8Array(n);
        this.cellShade = new Float32Array(n);
        this.cellKey = new Uint32Array(n);
        this.cellDepth = new Float32Array(n);
        this.cellKind = new Uint8Array(n);
        this.ambientStamp = new Uint32Array(n);
      }

      this.paintBackground();
    }

    paintBackground() {
      const g = this.bg.getContext("2d");
      if (!g) return;
      const { width: W, height: H, dpr, cw, ch } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#fafbfe";
      g.fillRect(0, 0, W, H);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = "rgba(0, 0, 0, 0.035)";
      g.lineWidth = 1;
      g.beginPath();
      for (let c = 0; c <= Math.ceil(W / cw); c++) {
        const x = Math.round(c * cw * dpr) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, H * dpr);
      }
      for (let r = 0; r <= Math.ceil(H / ch); r++) {
        const y = Math.round(r * ch * dpr) + 0.5;
        g.moveTo(0, y);
        g.lineTo(W * dpr, y);
      }
      g.stroke();
    }

    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }

    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }

    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat" || e.kind === "divide") {
          this.stamp(this.heat, e.x, e.y, e.kind === "divide" ? 3 : 2, 1);
          this.stamp(this.energy, e.x, e.y, e.kind === "divide" ? 5 : 3, 1.0);
        } else if (e.kind === "pulse") {
          this.stamp(this.energy, e.x, e.y, 4, 0.7);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }

    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }

    drawDots() {
      const { ctx, cols, rows, cw, ch, energy, cellFlag } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        if (cellFlag[i] || e < 0.42) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const level = clamp(Math.floor((e - 0.42) * 6), 0, ALPHA_LEVELS - 1);
        ctx.fillStyle = this.dotStyles[level];
        const size = Math.max(2, Math.round(cw * 0.22));
        ctx.fillRect(
          Math.round(col * cw + cw * 0.66 - size / 2),
          Math.round(row * ch + ch * 0.64 - size / 2),
          size,
          size
        );
      }
    }

    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }

    markAmbient(particles) {
      const { ambientStamp, ambientBuckets, cellFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of ambientBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const p of particles) {
          if (!p.alive || (p.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(p.x, p.y);
          if (i < 0 || ambientStamp[i] === frame || cellFlag[i]) continue;
          ambientStamp[i] = frame;
          const glint = clamp(Math.abs(p.turn || 0) / 3.5, 0, 1);
          const v = 0.3 + (0.4 * (p.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, p.alarm || 0);
          ambientBuckets[clamp(Math.floor(v * AMBIENT_ALPHAS.length), 0, AMBIENT_ALPHAS.length - 1)].push(i);
        }
      }
    }

    drawAmbient(customGlyphs) {
      const { ctx, cw, ch, cols, ambientBuckets } = this;
      for (let b = 0; b < ambientBuckets.length; b++) {
        const bucket = ambientBuckets[b];
        if (!bucket.length) continue;
        const a = AMBIENT_ALPHAS[b];
        ctx.fillStyle = `rgba(51, 65, 85, ${a * 0.75})`;
        for (const i of bucket) {
          const chGlyph = customGlyphs ? customGlyphs[(i + b) % customGlyphs.length] : this.ambientGlyph;
          ctx.fillText(chGlyph, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
        }
      }
    }

    drawCells(t) {
      const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind, kinds, tints } = this;
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
        const dim = 0.78 + 0.22 * cellDepth[i];
        const kindName = kinds[cellKind[i]] || kinds[0];
        const [tr, tg, tb] = tints[kindName] || [0.94, 0.97, 1.03];

        const tick = Math.floor(t * 2.4 + (key % 997) / 97);
        const roll = hash3(key, tick, 7);

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          ctx.fillStyle = roll < 0.07 ? ACCENTS[key % ACCENTS.length] : "rgba(100, 116, 139, 0.65)";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        let bgLevel;
        let glyph;
        if (flag === FLAG_RIDGE) {
          bgLevel = 100;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          bgLevel = 36;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          bgLevel = 115;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          bgLevel = 190 - shade * 65;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          bgLevel = 224 - shade * 105;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }

        bgLevel *= dim;
        const r = Math.min(255, Math.round(bgLevel * tr));
        const g = Math.min(255, Math.round(bgLevel * tg));
        const b = Math.min(255, Math.round(bgLevel * tb + 3));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

        let glyphColor;
        if (flag === FLAG_EYE) {
          glyphColor = "#ffffff";
        } else if (flag === FLAG_MARK) {
          glyphColor = "#0f172a";
        } else if (roll < 0.08) {
          glyphColor = ACCENTS[key % ACCENTS.length];
        } else if (roll < 0.12) {
          glyphColor = "#ffffff";
        } else if (bgLevel < 138) {
          glyphColor = "#f8fafc";
        } else {
          glyphColor = "#1e293b";
        }
        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

  // ── SHARED ENGINE LOOP WRAPPER ───────────────────────────────────────────

  class BaseLoopEngine {
    constructor(canvas, world, renderer) {
      this.canvas = canvas;
      this.world = world;
      this.renderer = renderer;
      this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
      this.raf = 0;
      this.last = 0;
      this.acc = 0;
      this.disposed = false;

      this.onResize = () => this.resize();
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
      window.addEventListener("resize", this.onResize);

      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);

      this.resize();
      this.schedule();
    }

    destroy() {
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerdown", this.onPointerDown);
      document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
      window.removeEventListener("resize", this.onResize);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width > 10 ? rect.width : window.innerWidth;
      const h = rect.height > 10 ? rect.height : window.innerHeight;
      if (w < 1 || h < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.resize(w, h, dpr);
      this.world.resize(w, h, this.renderer.cellWidth, this.renderer.cellHeight);
    }

    schedule() {
      cancelAnimationFrame(this.raf);
      if (this.disposed) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    frame = (now) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
      this.renderer.render(this.world, dt);
      this.raf = requestAnimationFrame(this.frame);
    };

    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      return { x, y, inside };
    }

    onPointerMove = (e) => {
      const { x, y, inside } = this.toLocal(e);
      const p = this.world.pointer;
      p.x = x;
      p.y = y;
      p.active = inside;
    };

    onPointerDown = (e) => {
      if (
        e.target &&
        e.target !== this.canvas &&
        e.target.closest &&
        e.target.closest(".focus-card, .modal-backdrop, .floating-pill, button, input, select, a")
      ) {
        return;
      }
      const { x, y, inside } = this.toLocal(e);
      if (inside) this.world.splash(x, y);
    };

    onPointerLeave = () => {
      this.world.pointer.active = false;
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MANTA RAYS ENGINE ("mantas")
  // ═══════════════════════════════════════════════════════════════════════════

  const MANTA_NODES = 22;
  const MANTA_SHAPES = {
    giant_manta: {
      discNodes: 10, // ~42% disc, 58% whip tail
      wingSpan: 0.55,
      cephalic: true,
      hornLen: 0.23,
      roundedDisc: false,
      pattern: "manta_patches",
      palette: "slate_gray",
      tint: [0.43, 0.46, 0.51], // Charcoal / slate gray with stark white shoulder patches
    },
    spotted_eagle: {
      discNodes: 10,
      wingSpan: 0.50,
      cephalic: false,
      duckbill: true,
      roundedDisc: false,
      pattern: "white_dots",
      palette: "deep_blue",
      tint: [0.17, 0.29, 0.54], // Full deep navy blue spotted with bright white ASCII letter infills
    },
    leopard_ray: {
      discNodes: 12, // Rounded saucer disc (~52% of length)
      wingSpan: 0.40,
      cephalic: false,
      duckbill: false,
      roundedDisc: true, // Smooth oval/circular stingray silhouette
      pattern: "leopard_rosettes",
      palette: "brown_black",
      tint: [0.76, 0.57, 0.36], // Warm sandy-brown disc with charcoal-black leopard rosettes
    },
    reef_manta: {
      discNodes: 11,
      wingSpan: 0.50,
      cephalic: true,
      hornLen: 0.20,
      curvedWings: true,
      roundedDisc: false,
      pattern: "reef_chevron",
      palette: "steel_blue",
      tint: [0.32, 0.54, 0.76], // Lighter steel / cerulean ocean blue with dorsal V-chevron
    },
  };
  const MANTA_KINDS = Object.keys(MANTA_SHAPES);
  const MANTA_TINTS = {};
  for (const k of MANTA_KINDS) MANTA_TINTS[k] = MANTA_SHAPES[k].tint;

  const DEFAULT_MANTAS = [
    { kind: "giant_manta", size: 0.96 },
    { kind: "spotted_eagle", size: 0.88 },
    { kind: "reef_manta", size: 0.80 },
    { kind: "leopard_ray", size: 0.78 },
  ];

  class MantaWorld {
    constructor(specs = DEFAULT_MANTAS) {
      this.specs = specs;
      this.width = 0;
      this.height = 0;
      this.time = 0;
      this.mantas = [];
      this.fish = [];
      this.events = [];
      this.pointer = { x: 0, y: 0, active: false };
      this.tmp = { x: 0, y: 0 };
    }

    resize(width, height) {
      const first = this.width === 0;
      this.width = width;
      this.height = height;
      if (first || this.mantas.length === 0) {
        this.seed();
        return;
      }
      for (const f of this.fish) {
        f.x = clamp(f.x, 0, width);
        f.y = clamp(f.y, 0, height);
      }
    }

    seed() {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H) || 600;
      const baseLen = clamp(minSide * 0.39, 185, 345);
      const count = this.specs.length;

      this.mantas = [];
      for (let i = 0; i < count; i++) {
        const { kind, size } = this.specs[i];
        const length = baseLen * size;
        // Distinct orbital lanes so mantas don't crowd the same radius
        const orbitRadius = minSide * (0.21 + i * 0.068 + rand(-0.015, 0.015));
        const a = (i / count) * TAU + rand(-0.18, 0.18);
        const orbitDir = i % 2 === 0 ? 1 : -1;
        const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.88;
        const y = H / 2 + Math.sin(a) * orbitRadius;
        const heading = a + (orbitDir * Math.PI) / 2;
        const nodes = new Float32Array(MANTA_NODES * 2);
        const seg = length / (MANTA_NODES - 1);
        for (let n = 0; n < MANTA_NODES; n++) {
          nodes[n * 2] = x - Math.cos(heading) * seg * n;
          nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
        }
        this.mantas.push({
          id: i + 1,
          kind,
          length,
          nodes,
          heading,
          speed: 30,
          phase: rand(0, TAU),
          turn: 0,
          wander: 0,
          orbitDir,
          orbitRadius,
          depth: size,
        });
      }
      this.mantas.sort((a, b) => a.length - b.length);

      const fTotal = clamp(Math.round((W * H) / 4800), 80, 280);
      this.fish = [];
      for (let i = 0; i < fTotal; i++) {
        const dir = rand(0, TAU);
        const spd = rand(24, 42);
        this.fish.push({
          x: rand(0, W),
          y: rand(0, H),
          vx: Math.cos(dir) * spd,
          vy: Math.sin(dir) * spd,
          alarm: 0,
          alive: true,
          turn: 0,
          depth: rand(0.55, 1),
          escortId: i < 28 ? (i % count) : -1,
          escortSide: i % 2 === 0 ? 1 : -1,
          escortDist: rand(0.32, 0.62),
        });
      }
    }

    splash(x, y) {
      this.events.push({ kind: "splash", x, y });
      const r = 240;
      for (const f of this.fish) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d > r || d < 1e-3) continue;
        const k = (1 - d / r) * 260;
        f.vx += (dx / d) * k;
        f.vy += (dy / d) * k;
        f.alarm = 1;
      }
    }

    step(dt) {
      this.time += dt;
      this.stepMantas(dt);
      this.stepFish(dt);
    }

    stepMantas(dt) {
      const { mantas, pointer, width: W, height: H, time } = this;
      const minSide = Math.min(W, H) || 600;
      const cxW = W / 2;
      const cyW = H / 2;

      for (const m of mantas) {
        const L = m.length;
        const shape = MANTA_SHAPES[m.kind] || MANTA_SHAPES.giant_manta;
        const nodes = m.nodes;
        const hx = nodes[0];
        const hy = nodes[1];
        const fx0 = Math.cos(m.heading);
        const fy0 = Math.sin(m.heading);
        const nx0 = -fy0;
        const ny0 = fx0;

        let dx = fx0 * 1.25;
        let dy = fy0 * 1.25;
        m.wander = clamp(m.wander + (Math.random() - 0.5) * dt * 1.8, -0.75, 0.75);
        dx += Math.cos(m.heading + m.wander) * 0.34;
        dy += Math.sin(m.heading + m.wander) * 0.34;

        const rx = (hx - cxW) / (W / minSide);
        const ry = hy - cyW;
        const r = Math.hypot(rx, ry) || 1;
        const radius = m.orbitRadius * (1 + 0.15 * Math.sin(time * 0.045 + m.id * 1.3));
        const radial = clamp((radius - r) / radius, -1, 1);
        dx += ((-ry / r) * m.orbitDir + (rx / r) * radial * 0.80) * 0.54;
        dy += ((rx / r) * m.orbitDir + (ry / r) * radial * 0.80) * 0.54;

        if (pointer.active) {
          const pdx = hx - pointer.x;
          const pdy = hy - pointer.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < L * 0.55 + 50 && pd > 1e-3) {
            const pw = (1 - pd / (L * 0.55 + 50)) * 2.0;
            const side = pdx * nx0 + pdy * ny0 >= 0 ? 1 : -1;
            dx += (nx0 * side * 0.8 + (pdx / pd) * 0.4) * pw;
            dy += (ny0 * side * 0.8 + (pdy / pd) * 0.4) * pw;
          }
        }

        // Predictive CPA Path-Crossing Avoidance & Compact Elliptical Disc Box:
        // Anticipates path crossings early and steers tangentially (laterally) with gentle speed
        // staggering so wide-winged mantas glide past each other without interrupting paths!
        let speedMod = 1.0;
        let latSlide = 0;
        const myDiscX = nodes[6];
        const myDiscY = nodes[7];

        for (const other of mantas) {
          if (other === m) continue;
          const otherShape = MANTA_SHAPES[other.kind] || MANTA_SHAPES.giant_manta;
          const oDiscX = other.nodes[6];
          const oDiscY = other.nodes[7];

          const toX = oDiscX - myDiscX;
          const toY = oDiscY - myDiscY;
          const curDist = Math.hypot(toX, toY) || 1;

          const ovx = Math.cos(other.heading) * other.speed;
          const ovy = Math.sin(other.heading) * other.speed;
          const rvx = ovx - fx0 * m.speed;
          const rvy = ovy - fy0 * m.speed;
          const rv2 = rvx * rvx + rvy * rvy;
          const tCPA = rv2 > 1e-2 ? clamp(-(toX * rvx + toY * rvy) / rv2, 0, 4.5) : 0;
          const cpaX = toX + rvx * tCPA;
          const cpaY = toY + rvy * tCPA;
          const cpaDist = Math.hypot(cpaX, cpaY);
          const effDist = Math.min(curDist, cpaDist * 0.88 + curDist * 0.12);

          // Radar radius scaled to the combined wingspans so they curve smoothly before wings overlap
          const radarRange = (L * shape.wingSpan + other.length * otherShape.wingSpan) * 1.35;
          if (effDist < radarRange) {
            const ahead = (toX / curDist) * fx0 + (toY / curDist) * fy0;
            if (ahead > -0.30) {
              const prox = Math.pow(1 - effDist / radarRange, 1.25);
              const latOffset = -(cpaX * nx0 + cpaY * ny0);
              const passSide = Math.abs(latOffset) > L * 0.12
                ? (latOffset > 0 ? 1 : -1)
                : (m.id < other.id ? 1 : -1);
              const w = prox * 2.1 * (0.55 + 0.45 * Math.max(0, ahead));
              dx += nx0 * passSide * w;
              dy += ny0 * passSide * w;

              if (ahead > 0.15) {
                speedMod *= m.id < other.id ? 1 + 0.15 * prox : 1 - 0.13 * prox;
              }
            }
          }

          // Compact core collision box (inner body only, not outer wingtips) for soft lateral slide
          const coreRange = (L + other.length) * 0.28;
          if (curDist < coreRange && curDist > 1e-3) {
            const push = (1 - curDist / coreRange) * 16;
            const latProj = (-toX / curDist) * nx0 + (-toY / curDist) * ny0;
            const slideSign = Math.abs(latProj) > 0.08 ? Math.sign(latProj) : (m.id < other.id ? 1 : -1);
            latSlide += slideSign * push;
          }
        }

        const edgePad = 95;
        const over = Math.max(-hx + edgePad, hx - (W - edgePad), -hy + edgePad, hy - (H - edgePad));
        if (over > 0) {
          const w = clamp(over / (edgePad * 0.85), 0, 1) * 2.6;
          const toX = cxW - hx;
          const toY = cyW - hy;
          const d = Math.hypot(toX, toY) || 1;
          dx += (toX / d) * w;
          dy += (toY / d) * w;
        }

        const desired = Math.atan2(dy, dx);
        const maxTurn = 0.58 * dt;
        const turned = clamp(angleDiff(m.heading, desired), -maxTurn, maxTurn);
        m.heading += turned;
        m.turn += (turned / dt - m.turn) * Math.min(1, dt * 2.8);

        const flapThrust = 1 + 0.14 * Math.sin(m.phase * 2);
        const cruise = (27 + L * 0.034) * flapThrust * clamp(speedMod, 0.84, 1.18);
        m.speed += (cruise - m.speed) * Math.min(1, dt * 1.8);
        m.phase += dt * (2.05 + m.speed / 36);

        const fx = Math.cos(m.heading);
        const fy = Math.sin(m.heading);
        nodes[0] += (fx * m.speed - fy * latSlide) * dt;
        nodes[1] += (fy * m.speed + fx * latSlide) * dt;

        const seg = L / (MANTA_NODES - 1);
        const discNodes = (MANTA_SHAPES[m.kind] || MANTA_SHAPES.giant_manta).discNodes || 10;
        let prevAngle = m.heading + Math.PI;
        for (let k = 1; k < MANTA_NODES; k++) {
          const px = nodes[(k - 1) * 2];
          const py = nodes[(k - 1) * 2 + 1];
          const maxBend = k < discNodes ? 0.09 : 0.24;
          let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
          angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
          nodes[k * 2] = px + Math.cos(angle) * seg;
          nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
          prevAngle = angle;
        }
      }
    }

    stepFish(dt) {
      const { fish, mantas, pointer, width: W, height: H, time, tmp: cur } = this;
      const calm = Math.exp(-dt * 0.8);
      for (const f of fish) {
        f.alarm *= calm;
        flowCurrent(f.x, f.y, time, cur);
        let ax = cur.x * 0.55 + (Math.random() - 0.5) * 35;
        let ay = cur.y * 0.55 + (Math.random() - 0.5) * 35 - f.vy * 0.5;

        if (f.escortId >= 0 && f.escortId < mantas.length && f.alarm < 0.3) {
          const m = mantas[f.escortId];
          const fx = Math.cos(m.heading);
          const fy = Math.sin(m.heading);
          const nx = -fy;
          const ny = fx;
          const tx = m.nodes[4] - fx * m.length * 0.12 + nx * f.escortSide * m.length * f.escortDist * 0.45;
          const ty = m.nodes[5] - fy * m.length * 0.12 + ny * f.escortSide * m.length * f.escortDist * 0.45;
          ax += (tx - f.x) * 1.8 + (fx * m.speed - f.vx) * 2.2;
          ay += (ty - f.y) * 1.8 + (fy * m.speed - f.vy) * 2.2;
        }

        if (pointer.active) {
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 140 && d > 1e-3) {
            const w = (1 - d / 140) ** 2;
            ax += (dx / d) * 900 * w;
            ay += (dy / d) * 900 * w;
            f.alarm = Math.max(f.alarm, w);
          }
        }

        const mPad = 36;
        if (f.x < mPad) ax += (mPad - f.x) * 6;
        else if (f.x > W - mPad) ax -= (f.x - (W - mPad)) * 6;
        if (f.y < mPad) ay += (mPad - f.y) * 6;
        else if (f.y > H - mPad) ay -= (f.y - (H - mPad)) * 6;

        const before = Math.atan2(f.vy, f.vx);
        f.vx += ax * dt;
        f.vy += ay * dt;
        const spd = Math.hypot(f.vx, f.vy) || 1;
        const maxSpd = 58 * (1 + f.alarm * 1.4);
        if (spd > maxSpd) {
          f.vx *= maxSpd / spd;
          f.vy *= maxSpd / spd;
        } else if (spd < 18) {
          f.vx *= 18 / spd;
          f.vy *= 18 / spd;
        }
        f.turn = angleDiff(before, Math.atan2(f.vy, f.vx)) / dt;
        f.x = clamp(f.x + f.vx * dt, -40, W + 40);
        f.y = clamp(f.y + f.vy * dt, -40, H + 40);
      }
    }
  }

  class MantaRenderer extends BaseAsciiRenderer {
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

  class MantaEngine extends BaseLoopEngine {
    constructor(canvas, specs) {
      const world = new MantaWorld(specs);
      const renderer = new MantaRenderer(canvas);
      super(canvas, world, renderer);
    }
  }



  return { MantaEngine, MantaWorld, MantaRenderer, MANTA_SHAPES, MANTA_KINDS };
}));
