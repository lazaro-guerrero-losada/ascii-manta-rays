export interface MantaShape {
  discNodes: number;
  wingSpan: number;
  cephalic: boolean;
  hornLen?: number;
  roundedDisc: boolean;
  duckbill?: boolean;
  curvedWings?: boolean;
  pattern: string;
  palette: string;
  tint: [number, number, number];
}

export interface MantaSpec {
  kind: string;
  size: number;
}

export const MANTA_NODES = 22;

export const MANTA_SHAPES: Record<string, MantaShape> = {
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

export const MANTA_KINDS = Object.keys(MANTA_SHAPES);
export const MANTA_TINTS: Record<string, [number, number, number]> = {};
for (const k of MANTA_KINDS) MANTA_TINTS[k] = MANTA_SHAPES[k].tint;

export const DEFAULT_MANTAS: MantaSpec[] = [
  { kind: "giant_manta", size: 0.96 },
  { kind: "spotted_eagle", size: 0.88 },
  { kind: "reef_manta", size: 0.82 },
  { kind: "leopard_ray", size: 0.84 },
];
