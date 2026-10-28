/**
 * Pure image -> ASCII conversion utilities.
 *
 * The conversion is intentionally side-effect-free aside from a few
 * module-scoped canvases / buffers / caches that we reuse across calls to
 * avoid GC churn during video playback. The function does not mutate any inputs.
 *
 * Pipeline per call:
 *  1. Draw the source at `cols*sx x rows*sy` (supersampled) and box-average
 *     each cell in linear light, weighted by alpha. Each cell is also split
 *     into a 2x3 grid of sub-regions for shape matching.
 *  2. Convert to perceptual lightness (sRGB-encoded BT.709 luminance).
 *  3. Apply tone adjustments through a lookup table: auto-levels, contrast,
 *     brightness, gamma, invert. Transparency fades cells towards blank.
 *  4. Optionally replace strong edges with directional glyphs (| / - \).
 *  5. Pick a glyph per cell: by shape (default), by measured density, or by
 *     plain charset position; optionally dithered.
 */

export type AsciiDither = "none" | "floyd-steinberg" | "atkinson" | "ordered";

/**
 * - `shape`: every glyph is rendered once and measured over a 2x3 grid; each
 *   cell picks the glyph whose ink layout best matches the image there. Edges
 *   and fine detail come out much sharper than with brightness alone.
 * - `measured`: brightness maps to measured glyph coverage (charset re-sorted).
 * - `linear`: charset used as-is, brightness split into equal-width bins.
 */
export type AsciiGlyphMapping = "shape" | "measured" | "linear";

export interface ImageToAsciiOptions {
  /** Number of ASCII columns. Rows are derived from the source aspect ratio. */
  columns: number;
  /** Characters ordered from darkest (index 0) to brightest (last index). */
  charset: string;
  /** Flip the brightness -> char mapping. */
  invert: boolean;
  /** Capture per-cell colors for color rendering. */
  useColors: boolean;
  /**
   * Pixel-aspect compensation for tall glyphs. Typical monospace fonts render
   * ~2x as tall as wide, so a value around 0.5 keeps the picture square.
   */
  cellAspect: number;
  /**
   * Optional brightness offset in the [-100, 100] range. Mapped to a small
   * additive offset on the 0-255 luminance prior to charset lookup. The "Threshold"
   * slider in the UI feeds this so the user can push the image lighter or darker.
   */
  threshold?: number;
  /** Contrast in the [-100, 100] range around mid-grey. Default 0. */
  contrast?: number;
  /** Midtone gamma (> 0). Values above 1 lift midtones. Default 1. */
  gamma?: number;
  /**
   * Stretch the 1st..99th percentile of lightness to the full range. Rescues
   * flat / washed-out sources. Default false.
   */
  autoLevels?: boolean;
  /**
   * Dithering applied while quantizing. Error diffusion ("floyd-steinberg",
   * "atkinson") works on brightness only, so it bypasses shape matching.
   * Default "none".
   */
  dither?: AsciiDither;
  /** How cells map to glyphs. Default "shape". */
  glyphMapping?: AsciiGlyphMapping;
  /**
   * Resolved CSS font-family used to measure glyphs for `shape` / `measured`.
   * CSS variables are not resolved here.
   */
  font?: string;
  /** Replace strong edges with directional glyphs (| / - \). Default false. */
  edges?: boolean;
  /** Edge strength in [0, 1] required before a cell becomes an edge glyph. Default 0.35. */
  edgeThreshold?: number;
  /**
   * Max supersamples per axis per cell (1-8). Higher is more accurate but
   * slower. Default 4. Shape matching always uses at least 2x3.
   */
  samples?: number;
}

export interface ImageToAsciiResult {
  text: string;
  /**
   * Present only when `useColors: true`. `colors[row][col]` is `rgb(r,g,b)`.
   * Built lazily on first access; prefer `colorData` for canvas painting.
   */
  colors?: string[][];
  /** Present only when `useColors: true`. Row-major RGBA, one pixel per cell. */
  colorData?: Uint8ClampedArray;
  rows: number;
  cols: number;
}

export type ConvertibleSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement;

const DEFAULT_CHARSET = " .:-=+*#%@";
const DEFAULT_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
/** Upper bound on supersampled pixels per call, keeps video playback smooth. */
const MAX_SAMPLE_PIXELS = 400_000;
const LUT_SIZE = 1024;
const SHAPE_COLS = 2;
const SHAPE_ROWS = 3;
const SHAPE_DIMS = SHAPE_COLS * SHAPE_ROWS;
/** Levels per sub-region in the shape cache key (4 bits x 6 = 24-bit key). */
const SHAPE_LEVELS = 15;
const SHAPE_CACHE_SIZE = 1 << 16;
/**
 * How strongly sub-region differences are exaggerated before matching
 * (0 = off). Without it, soft edges average out into blobs of mid-density glyphs.
 */
const SHAPE_SHARPEN = 0.6;
/**
 * Min spread between a cell's darkest and brightest sub-region before shape
 * matching kicks in. Flat cells use the density ramp instead: in a 2x3 grid
 * glyphs like `|` look perfectly "flat", so matching flat cells by shape would
 * turn smooth gradients into stripes.
 */
const SHAPE_MIN_CONTRAST = 0.18;
// 4x4 Bayer matrix, pre-normalized to (n + 0.5) / 16 - 0.5 => [-0.47, 0.47].
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (n) => (n + 0.5) / 16 - 0.5,
);

const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return table;
})();

function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const ENCODE_STEPS = 4096;
const LINEAR_TO_SRGB = (() => {
  const table = new Float32Array(ENCODE_STEPS + 1);
  for (let i = 0; i <= ENCODE_STEPS; i++) {
    table[i] = linearToSrgb(i / ENCODE_STEPS);
  }
  return table;
})();

/** Table-driven linear -> sRGB for the hot loop. Input must be in [0, 1]. */
function encode(c: number): number {
  return LINEAR_TO_SRGB[(c * ENCODE_STEPS + 0.5) | 0];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchContext(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
  }
  if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
    scratchCanvas.width = width;
    scratchCanvas.height = height;
  }
  if (!scratchCtx || scratchCtx.canvas !== scratchCanvas) {
    scratchCtx = scratchCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | null;
  }
  if (!scratchCtx) {
    throw new Error("ascii-converter: 2D canvas context is unavailable");
  }
  return { canvas: scratchCanvas, ctx: scratchCtx };
}

function getSourceDimensions(source: ConvertibleSource): {
  width: number;
  height: number;
} {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth || source.clientWidth || 0,
      height: source.videoHeight || source.clientHeight || 0,
    };
  }
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

/* -------------------------------------------------------------------------- */
/* Reusable buffers                                                           */
/* -------------------------------------------------------------------------- */

// Per-cell working memory, grown on demand and reused across frames.
let cellValue = new Float32Array(0);
let cellAlpha = new Float32Array(0);
let regionValue = new Float32Array(0);
let regionAlpha = new Float32Array(0);

function ensureBuffers(cells: number) {
  if (cellValue.length >= cells) return;
  cellValue = new Float32Array(cells);
  cellAlpha = new Float32Array(cells);
  regionValue = new Float32Array(cells * SHAPE_DIMS);
  regionAlpha = new Float32Array(cells * SHAPE_DIMS);
}

const toneLut = new Float32Array(LUT_SIZE);

/* -------------------------------------------------------------------------- */
/* Glyph tables                                                               */
/* -------------------------------------------------------------------------- */

interface GlyphTable {
  /** Code-point-safe glyphs; sorted by ink unless mapping is `linear`. */
  glyphs: string[];
  /** Perceptual brightness each glyph represents, ascending, 0..1. */
  levels: Float32Array;
  /** Quantized brightness (0..LUT_SIZE-1) -> glyph index. */
  lut: Uint16Array;
  /** Perceptual ink per sub-region, `SHAPE_DIMS` per glyph (shape mapping). */
  shapes?: Float32Array;
  /** Open-addressed cache: quantized sub-region key -> best glyph index. */
  shapeKeys?: Int32Array;
  shapeVals?: Uint16Array;
}

const glyphTableCache = new Map<string, GlyphTable>();

interface GlyphMetrics {
  /** Mean ink coverage over the whole glyph box, 0..1. */
  coverage: Float32Array;
  /** Ink coverage per 2x3 sub-region, 0..1. */
  regions: Float32Array;
}

/** Renders each glyph off-screen and measures where its ink lands. */
function measureGlyphs(glyphs: string[], font: string): GlyphMetrics {
  const n = glyphs.length;
  const coverage = new Float32Array(n);
  const regions = new Float32Array(n * SHAPE_DIMS);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { coverage, regions };

  const size = 36;
  ctx.font = `${size}px ${font}`;
  // Box = one monospace cell: advance width x em height (textBaseline "top"
  // matches how the preview and exporters place glyphs).
  const width = Math.max(1, Math.ceil(ctx.measureText("M").width));
  const height = Math.ceil(size * 1.05);
  canvas.width = width;
  canvas.height = height;
  // Resizing resets context state.
  ctx.font = `${size}px ${font}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";

  const regionSums = new Float64Array(SHAPE_DIMS);
  const regionPixels = new Float64Array(SHAPE_DIMS);
  for (let y = 0; y < height; y++) {
    const rr = Math.min(SHAPE_ROWS - 1, ((y * SHAPE_ROWS) / height) | 0);
    for (let x = 0; x < width; x++) {
      const rc = Math.min(SHAPE_COLS - 1, ((x * SHAPE_COLS) / width) | 0);
      regionPixels[rr * SHAPE_COLS + rc]++;
    }
  }

  for (let g = 0; g < n; g++) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillText(glyphs[g], 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    regionSums.fill(0);
    let total = 0;
    for (let y = 0; y < height; y++) {
      const rr = Math.min(SHAPE_ROWS - 1, ((y * SHAPE_ROWS) / height) | 0);
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        if (a === 0) continue;
        const rc = Math.min(SHAPE_COLS - 1, ((x * SHAPE_COLS) / width) | 0);
        regionSums[rr * SHAPE_COLS + rc] += a;
        total += a;
      }
    }
    coverage[g] = total / (width * height * 255);
    for (let k = 0; k < SHAPE_DIMS; k++) {
      regions[g * SHAPE_DIMS + k] = regionSums[k] / (regionPixels[k] * 255);
    }
  }
  return { coverage, regions };
}

function buildLut(levels: Float32Array, bins: boolean): Uint16Array {
  const lut = new Uint16Array(LUT_SIZE);
  const n = levels.length;
  let idx = 0;
  for (let q = 0; q < LUT_SIZE; q++) {
    const v = q / (LUT_SIZE - 1);
    if (bins) {
      // Equal-width bins: every glyph gets the same share of the range.
      lut[q] = Math.min(n - 1, Math.floor(v * n));
      continue;
    }
    // Levels are ascending, so the nearest index only ever moves forward.
    while (
      idx < n - 1 &&
      Math.abs(levels[idx + 1] - v) <= Math.abs(levels[idx] - v)
    ) {
      idx++;
    }
    lut[q] = idx;
  }
  return lut;
}

function getGlyphTable(
  charset: string,
  mapping: AsciiGlyphMapping,
  font: string,
): GlyphTable {
  const key = `${mapping}\u0000${font}\u0000${charset}`;
  const cached = glyphTableCache.get(key);
  if (cached) return cached;

  // Array.from splits by code point so astral glyphs (e.g. hieroglyphs) stay whole.
  let glyphs = Array.from(charset);
  const n = glyphs.length;
  let levels = new Float32Array(n);
  let bins = true;
  let shapes: Float32Array | undefined;

  if (mapping !== "linear" && n > 1) {
    const metrics = measureGlyphs(glyphs, font);
    const order = glyphs
      .map((_, i) => i)
      .sort((a, b) => metrics.coverage[a] - metrics.coverage[b]);
    const min = metrics.coverage[order[0]];
    const range = metrics.coverage[order[n - 1]] - min;
    if (range > 0) {
      glyphs = order.map((i) => glyphs[i]);
      // Displayed brightness is linear in ink coverage; store it perceptually
      // so it compares directly against the perceptual lightness we quantize.
      levels = Float32Array.from(order, (i) =>
        linearToSrgb((metrics.coverage[i] - min) / range),
      );
      bins = false;

      if (mapping === "shape") {
        // Each glyph's sub-regions are scaled so their mean equals its
        // brightness level: tone matches the density mapping exactly and the
        // sub-regions only add *where* inside the cell the ink sits.
        shapes = new Float32Array(n * SHAPE_DIMS);
        for (let g = 0; g < n; g++) {
          const src = order[g];
          let mean = 0;
          for (let k = 0; k < SHAPE_DIMS; k++) {
            mean += metrics.regions[src * SHAPE_DIMS + k];
          }
          mean /= SHAPE_DIMS;
          const scale = mean > 0 ? levels[g] / mean : 0;
          for (let k = 0; k < SHAPE_DIMS; k++) {
            shapes[g * SHAPE_DIMS + k] =
              metrics.regions[src * SHAPE_DIMS + k] * scale;
          }
        }
      }
    }
  }
  if (bins) {
    for (let k = 0; k < n; k++) levels[k] = n > 1 ? k / (n - 1) : 0;
  }

  const table: GlyphTable = { glyphs, levels, lut: buildLut(levels, bins) };
  if (shapes) {
    table.shapes = shapes;
    table.shapeKeys = new Int32Array(SHAPE_CACHE_SIZE).fill(-1);
    table.shapeVals = new Uint16Array(SHAPE_CACHE_SIZE);
  }
  // Don't cache measurements taken against a fallback font that is still loading.
  const fontsReady =
    mapping === "linear" ||
    typeof document === "undefined" ||
    !document.fonts ||
    document.fonts.status === "loaded";
  if (fontsReady) {
    if (glyphTableCache.size >= 8) glyphTableCache.clear();
    glyphTableCache.set(key, table);
  }
  return table;
}

const shapeQuery = new Float32Array(SHAPE_DIMS);

/**
 * Best glyph for a sub-region ink vector. Vectors are quantized to a 24-bit
 * key and memoized, so video frames mostly hit the cache. The match is
 * computed from the quantized vector, which keeps results frame-stable.
 */
function matchShape(table: GlyphTable, vec: Float32Array): number {
  const shapes = table.shapes!;
  const keys = table.shapeKeys!;
  const vals = table.shapeVals!;

  let key = 0;
  for (let k = 0; k < SHAPE_DIMS; k++) {
    const q = (vec[k] * SHAPE_LEVELS + 0.5) | 0;
    key |= q << (k * 4);
    shapeQuery[k] = q / SHAPE_LEVELS;
  }
  const slot = Math.imul(key, 0x9e3779b1) >>> 16;
  if (keys[slot] === key) return vals[slot];

  let best = 0;
  let bestDist = Infinity;
  const n = table.glyphs.length;
  for (let g = 0, o = 0; g < n; g++, o += SHAPE_DIMS) {
    let d = 0;
    for (let k = 0; k < SHAPE_DIMS; k++) {
      const diff = shapeQuery[k] - shapes[o + k];
      d += diff * diff;
    }
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  keys[slot] = key;
  vals[slot] = best;
  return best;
}

/* -------------------------------------------------------------------------- */
/* Tone + edges                                                               */
/* -------------------------------------------------------------------------- */

/** 1st/99th percentile of lightness over visible cells. */
function percentileRange(
  value: Float32Array,
  alpha: Float32Array,
  cells: number,
): [number, number] {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < cells; i++) {
    if (alpha[i] <= 0) continue;
    hist[(value[i] * 255 + 0.5) | 0]++;
    total++;
  }
  if (total === 0) return [0, 1];
  const cut = total * 0.01;
  let lo = 0;
  for (let acc = 0; lo < 255 && acc + hist[lo] <= cut; lo++) acc += hist[lo];
  let hi = 255;
  for (let acc = 0; hi > 0 && acc + hist[hi] <= cut; hi--) acc += hist[hi];
  return hi - lo < 2 ? [0, 1] : [lo / 255, hi / 255];
}

/** Fills `toneLut` with lightness -> ink (after levels/contrast/gamma/invert). */
function buildToneLut(lo: number, hi: number, opts: ImageToAsciiOptions): void {
  const levelScale = 1 / (hi - lo);
  const contrast = Math.max(-100, Math.min(100, opts.contrast ?? 0)) / 100;
  const contrastFactor =
    contrast >= 0 ? 1 / Math.max(0.01, 1 - contrast) : 1 + contrast;
  const brightness = (opts.threshold ?? 0) / 100;
  const invGamma = opts.gamma && opts.gamma > 0 ? 1 / opts.gamma : 1;

  for (let q = 0; q < LUT_SIZE; q++) {
    let v = (q / (LUT_SIZE - 1) - lo) * levelScale;
    v = clamp01((v - 0.5) * contrastFactor + 0.5 + brightness);
    if (invGamma !== 1) v = Math.pow(v, invGamma);
    toneLut[q] = opts.invert ? 1 - v : v;
  }
}

function tone(v: number): number {
  return toneLut[(v * (LUT_SIZE - 1) + 0.5) | 0];
}

const EDGE_VERTICAL = "|";
const EDGE_HORIZONTAL = "-";
const EDGE_RISING = "/";
const EDGE_FALLING = "\\";

/**
 * Sobel over the ink grid. Returns an edge glyph per cell, or undefined where
 * the gradient is too weak. Angles are measured in source-pixel space so the
 * glyph matches the on-screen slope regardless of cell aspect.
 */
function detectEdges(
  ink: Float32Array,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  threshold: number,
): (string | undefined)[] {
  const out = new Array<string | undefined>(cols * rows);
  const at = (x: number, y: number) =>
    ink[
      (y < 0 ? 0 : y >= rows ? rows - 1 : y) * cols +
        (x < 0 ? 0 : x >= cols ? cols - 1 : x)
    ];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tl = at(x - 1, y - 1);
      const tc = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const ml = at(x - 1, y);
      const mr = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const bc = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      // A full black->white step yields 4, so /4 normalizes to ~[0, 1].
      if (Math.hypot(gx, gy) / 4 < threshold) continue;

      // Gradient direction folded to [0, PI); the edge runs perpendicular.
      let angle = Math.atan2(gy / cellH, gx / cellW);
      if (angle < 0) angle += Math.PI;
      const sector = Math.floor((angle + Math.PI / 8) / (Math.PI / 4)) % 4;
      out[y * cols + x] =
        sector === 0
          ? EDGE_VERTICAL
          : sector === 1
            ? EDGE_RISING
            : sector === 2
              ? EDGE_HORIZONTAL
              : EDGE_FALLING;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Colors                                                                     */
/* -------------------------------------------------------------------------- */

const colorStringCache = new Map<number, string>();

function buildColorGrid(
  data: Uint8ClampedArray,
  rows: number,
  cols: number,
): string[][] {
  const grid = new Array<string[]>(rows);
  for (let y = 0; y < rows; y++) {
    const row = new Array<string>(cols);
    for (let x = 0; x < cols; x++) {
      const p = (y * cols + x) * 4;
      const key = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
      let str = colorStringCache.get(key);
      if (str === undefined) {
        str = `rgb(${data[p]}, ${data[p + 1]}, ${data[p + 2]})`;
        if (colorStringCache.size > 65_536) colorStringCache.clear();
        colorStringCache.set(key, str);
      }
      row[x] = str;
    }
    grid[y] = row;
  }
  return grid;
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

const EMPTY_RESULT: ImageToAsciiResult = { text: "", rows: 0, cols: 0 };

export function imageToAscii(
  source: ConvertibleSource,
  opts: ImageToAsciiOptions,
): ImageToAsciiResult {
  const { width: srcW, height: srcH } = getSourceDimensions(source);
  if (!srcW || !srcH) return EMPTY_RESULT;

  const charset = opts.charset.length > 0 ? opts.charset : DEFAULT_CHARSET;
  const cellAspect = opts.cellAspect > 0 ? opts.cellAspect : 0.5;
  const cols = Math.max(1, Math.floor(opts.columns));
  const rows = Math.max(1, Math.round((cols * srcH * cellAspect) / srcW));
  const dither = opts.dither ?? "none";
  const diffuse = dither === "floyd-steinberg" || dither === "atkinson";
  const table = getGlyphTable(
    charset,
    opts.glyphMapping ?? "shape",
    opts.font || DEFAULT_FONT,
  );
  const useShape = !!table.shapes && !diffuse;

  // Samples per cell: as many source pixels as the cell spans, capped. Shape
  // matching needs at least one sample per sub-region.
  const maxSamples = Math.min(8, Math.max(1, Math.floor(opts.samples ?? 4)));
  const cellW = srcW / cols;
  const cellH = srcH / rows;
  const minSx = useShape ? SHAPE_COLS : 1;
  const minSy = useShape ? SHAPE_ROWS : 1;
  let sx = Math.max(minSx, Math.min(maxSamples, Math.round(cellW)));
  let sy = Math.max(minSy, Math.min(maxSamples, Math.round(cellH)));
  while (
    cols * sx * rows * sy > MAX_SAMPLE_PIXELS &&
    (sx > minSx || sy > minSy)
  ) {
    if (sx > minSx && (sx >= sy || sy <= minSy)) sx--;
    else sy--;
  }
  const sampleW = cols * sx;
  const sampleH = rows * sy;

  const { ctx } = getScratchContext(sampleW, sampleH);
  ctx.clearRect(0, 0, sampleW, sampleH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, sampleW, sampleH);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, sampleW, sampleH).data;
  } catch {
    // Tainted canvas (cross-origin image) -- nothing we can do client-side.
    return { ...EMPTY_RESULT, rows, cols };
  }

  const cellCount = cols * rows;
  ensureBuffers(cellCount);
  const value = cellValue;
  const alpha = cellAlpha;
  const colorData = opts.useColors
    ? new Uint8ClampedArray(cellCount * 4)
    : undefined;

  // Sample -> sub-region lookup, plus how many samples land in each region.
  const sampleRegionCol = new Uint8Array(sx);
  const sampleRegionRow = new Uint8Array(sy);
  for (let i = 0; i < sx; i++) {
    sampleRegionCol[i] = Math.min(SHAPE_COLS - 1, ((i * SHAPE_COLS) / sx) | 0);
  }
  for (let j = 0; j < sy; j++) {
    sampleRegionRow[j] =
      Math.min(SHAPE_ROWS - 1, ((j * SHAPE_ROWS) / sy) | 0) * SHAPE_COLS;
  }
  const regionSamples = new Float32Array(SHAPE_DIMS);
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      regionSamples[sampleRegionRow[j] + sampleRegionCol[i]]++;
    }
  }
  const regionY = new Float32Array(SHAPE_DIMS);
  const regionW = new Float32Array(SHAPE_DIMS);
  const invSampleArea = 1 / (sx * sy);
  const inv255 = 1 / 255;

  // 1-2. Alpha-weighted box filter in linear light -> perceptual lightness.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      let r = 0;
      let g = 0;
      let b = 0;
      let lum = 0;
      let a = 0;
      if (useShape) {
        for (let k = 0; k < SHAPE_DIMS; k++) {
          regionY[k] = 0;
          regionW[k] = 0;
        }
      }
      for (let j = 0; j < sy; j++) {
        const rowRegion = sampleRegionRow[j];
        let p = ((y * sy + j) * sampleW + x * sx) * 4;
        for (let i = 0; i < sx; i++, p += 4) {
          const pa = pixels[p + 3];
          if (pa === 0) continue;
          const w = pa * inv255;
          const lr = SRGB_TO_LINEAR[pixels[p]];
          const lg = SRGB_TO_LINEAR[pixels[p + 1]];
          const lb = SRGB_TO_LINEAR[pixels[p + 2]];
          // BT.709 coefficients are the correct ones for (linear) sRGB primaries.
          const yw = (0.2126 * lr + 0.7152 * lg + 0.0722 * lb) * w;
          lum += yw;
          a += w;
          if (useShape) {
            const k = rowRegion + sampleRegionCol[i];
            regionY[k] += yw;
            regionW[k] += w;
          }
          if (colorData) {
            r += lr * w;
            g += lg * w;
            b += lb * w;
          }
        }
      }

      alpha[cell] = a * invSampleArea;
      value[cell] = a > 0 ? encode(lum / a) : 0;
      if (useShape) {
        const base = cell * SHAPE_DIMS;
        for (let k = 0; k < SHAPE_DIMS; k++) {
          const w = regionW[k];
          regionValue[base + k] = w > 0 ? encode(regionY[k] / w) : 0;
          regionAlpha[base + k] = w / regionSamples[k];
        }
      }
      if (colorData && a > 0) {
        const p = cell * 4;
        colorData[p] = encode(r / a) * 255;
        colorData[p + 1] = encode(g / a) * 255;
        colorData[p + 2] = encode(b / a) * 255;
        colorData[p + 3] = 255;
      }
    }
  }

  // 3. Tone adjustments. `value` becomes "ink": 0 = blank, 1 = densest glyph.
  const [lo, hi] = opts.autoLevels
    ? percentileRange(value, alpha, cellCount)
    : [0, 1];
  buildToneLut(lo, hi, opts);
  for (let cell = 0; cell < cellCount; cell++) {
    value[cell] = tone(value[cell]) * alpha[cell];
  }

  // 4. Edge glyphs (computed before dithering mutates `value`).
  const edgeGlyphs = opts.edges
    ? detectEdges(
        value,
        cols,
        rows,
        cellW,
        cellH,
        clamp01(opts.edgeThreshold ?? 0.35),
      )
    : undefined;

  // 5. Pick glyphs.
  const { glyphs, levels, lut } = table;
  const orderedStep =
    dither === "ordered" ? 1 / Math.max(1, glyphs.length - 1) : 0;
  const shapeVec = new Float32Array(SHAPE_DIMS);

  const lineLength = cols + 1; // newline per row
  const text = new Array<string>(rows * lineLength);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      const outIdx = y * lineLength + x;

      if (alpha[cell] === 0) {
        // Fully transparent: always blank, and don't diffuse error into it.
        text[outIdx] = " ";
        continue;
      }
      const edge = edgeGlyphs?.[cell];
      if (edge) {
        text[outIdx] = edge;
        continue;
      }
      const bayer = orderedStep
        ? BAYER_4[(y & 3) * 4 + (x & 3)] * orderedStep
        : 0;

      if (useShape) {
        const base = cell * SHAPE_DIMS;
        let max = 0;
        let min = 1;
        for (let k = 0; k < SHAPE_DIMS; k++) {
          const v = clamp01(
            tone(regionValue[base + k]) * regionAlpha[base + k] + bayer,
          );
          shapeVec[k] = v;
          if (v > max) max = v;
          if (v < min) min = v;
        }
        if (max - min >= SHAPE_MIN_CONTRAST) {
          // Push sub-regions apart relative to the brightest one.
          for (let k = 0; k < SHAPE_DIMS; k++) {
            const v = shapeVec[k];
            shapeVec[k] = v + SHAPE_SHARPEN * ((v * v) / max - v);
          }
          text[outIdx] = glyphs[matchShape(table, shapeVec)];
          continue;
        }
      }

      const v = clamp01(value[cell] + bayer);
      const idx = lut[(v * (LUT_SIZE - 1) + 0.5) | 0];
      text[outIdx] = glyphs[idx];

      if (!diffuse) continue;
      const err = v - levels[idx];
      if (err === 0) continue;
      const hasRight = x + 1 < cols;
      const hasLeft = x > 0;
      const hasDown = y + 1 < rows;
      if (dither === "floyd-steinberg") {
        if (hasRight) value[cell + 1] += err * (7 / 16);
        if (hasDown) {
          if (hasLeft) value[cell + cols - 1] += err * (3 / 16);
          value[cell + cols] += err * (5 / 16);
          if (hasRight) value[cell + cols + 1] += err * (1 / 16);
        }
      } else {
        // Atkinson spreads only 6/8 of the error, which keeps highlights crisp.
        const e = err / 8;
        if (hasRight) value[cell + 1] += e;
        if (x + 2 < cols) value[cell + 2] += e;
        if (hasDown) {
          if (hasLeft) value[cell + cols - 1] += e;
          value[cell + cols] += e;
          if (hasRight) value[cell + cols + 1] += e;
        }
        if (y + 2 < rows) value[cell + 2 * cols] += e;
      }
    }
    text[y * lineLength + cols] = "\n";
  }

  const result: ImageToAsciiResult = { text: text.join(""), rows, cols };
  if (colorData) {
    result.colorData = colorData;
    // String colors are only needed by exporters; build them on demand.
    let grid: string[][] | undefined;
    Object.defineProperty(result, "colors", {
      enumerable: true,
      configurable: true,
      get: () => (grid ??= buildColorGrid(colorData, rows, cols)),
    });
  }
  return result;
}
