import { TAU, clamp, rand, smoothstep, angleDiff, flowCurrent } from "./math";
import {
  MANTA_NODES,
  MANTA_SHAPES,
  MANTA_KINDS,
  DEFAULT_MANTAS,
  type MantaShape,
  type MantaSpec,
} from "./species";

export interface MantaAgent {
  kind: string;
  shape: MantaShape;
  size: number;
  totalLen: number;
  discLen: number;
  wingSpan: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  targetHeading: number;
  roll: number;
  targetRoll: number;
  pitch: number;
  targetPitch: number;
  flapPhase: number;
  flapFreq: number;
  flapAmp: number;
  glide: number;
  turnRate: number;
  nodes: Array<{ x: number; y: number }>;
}

export interface RemoraAgent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  speed: number;
  targetManta: number;
  offsetAngle: number;
  offsetDist: number;
  alarm: number;
}

export interface RippleEvent {
  x: number;
  y: number;
  birth: number;
  strength: number;
}

export class MantaWorld {
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
