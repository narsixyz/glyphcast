/**
 * Fast canvas painter for ASCII frames.
 *
 * Calling `fillText` once per cell is the dominant cost of a live preview
 * (tens of thousands of calls per frame). When every glyph in the frame has
 * the same advance (any monospace font), each row is drawn with a single
 * `fillText` and `ctx.letterSpacing` stretches the advance to the cell width:
 *
 *  - Uniform ink (text color, gradients, effects): rows go straight onto the
 *    target context.
 *  - Per-cell source colors: rows are drawn white onto an offscreen layer,
 *    then tinted with `source-atop` by a 1px-per-cell color image stretched
 *    over each row. Glyphs can be taller than a row (tight line height), so
 *    rows are split into interleaved passes whose glyphs never overlap.
 *
 * Proportional fonts / mixed-width glyphs fall back to one `fillText` per cell.
 */

import type { ImageToAsciiResult } from "@/lib/ascii/ascii-converter";

export interface PaintGlyphsArgs {
  /** Target context, already scaled by `dpr`, with `font` set. */
  ctx: CanvasRenderingContext2D;
  dpr: number;
  result: ImageToAsciiResult;
  cellWidth: number;
  cellHeight: number;
  /** Uniform ink; ignored when per-cell colors are painted. */
  fill: string | CanvasGradient;
  /** Paint `result.colorData` (per-cell colors) instead of `fill`. */
  useColors: boolean;
  /** Per-row horizontal offset in CSS px (glitch jitter). */
  rowOffset?: (row: number) => number;
  /** Per-row ink opacity (scanline effect). Uniform fill only. */
  rowAlpha?: (row: number) => number;
  /** Glow around the ink. */
  shadow?: { blur: number; color: string };
}

type LetterSpacingContext = CanvasRenderingContext2D & {
  letterSpacing?: string;
};

interface FontInfo {
  /** Advance of the space glyph. */
  advance: number;
  /** Per UTF-16 code unit: 0 = unmeasured, 1 = same advance, 2 = different. */
  uniform: Uint8Array;
  /** Vertical ink extent relative to the row top (textBaseline "top"). */
  inkTop: number;
  inkBottom: number;
}

const fontInfoCache = new Map<string, FontInfo>();

function getFontInfo(ctx: CanvasRenderingContext2D): FontInfo {
  const key = `${ctx.font}\u0000${ctx.textBaseline}`;
  let info = fontInfoCache.get(key);
  if (!info) {
    // Probe with tall / deep glyphs instead of measuring every frame's text.
    const probe = ctx.measureText("|@QÅjgy_[]");
    info = {
      advance: ctx.measureText(" ").width,
      uniform: new Uint8Array(0x10000),
      inkTop: Math.min(0, -probe.actualBoundingBoxAscent),
      inkBottom: Math.max(1, probe.actualBoundingBoxDescent),
    };
    if (fontInfoCache.size >= 16) fontInfoCache.clear();
    fontInfoCache.set(key, info);
  }
  return info;
}

/**
 * Shared advance of every glyph in the frame, or null when they differ (or
 * the browser lacks `ctx.letterSpacing`).
 */
function uniformAdvance(
  ctx: CanvasRenderingContext2D,
  lines: string[],
): number | null {
  if (!("letterSpacing" in ctx)) return null;
  const { advance, uniform } = getFontInfo(ctx);
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      // Surrogate pairs (astral glyphs) are rarely monospace-wide.
      if (code >= 0xd800 && code <= 0xdfff) return null;
      let state = uniform[code];
      if (state === 0) {
        const w = ctx.measureText(line[i]).width;
        state = Math.abs(w - advance) <= 0.01 ? 1 : 2;
        uniform[code] = state;
      }
      if (state === 2) return null;
    }
  }
  return advance;
}

let layer: HTMLCanvasElement | null = null;
let layerCtx: CanvasRenderingContext2D | null = null;
let colorCanvas: HTMLCanvasElement | null = null;
let colorCtx: CanvasRenderingContext2D | null = null;

function getLayer(width: number, height: number) {
  if (!layer) {
    layer = document.createElement("canvas");
    layerCtx = layer.getContext("2d");
  }
  if (layer.width !== width || layer.height !== height) {
    layer.width = width;
    layer.height = height;
  }
  return { canvas: layer, ctx: layerCtx! };
}

function getColorImage(data: Uint8ClampedArray, cols: number, rows: number) {
  if (!colorCanvas) {
    colorCanvas = document.createElement("canvas");
    colorCtx = colorCanvas.getContext("2d");
  }
  if (colorCanvas.width !== cols || colorCanvas.height !== rows) {
    colorCanvas.width = cols;
    colorCanvas.height = rows;
  }
  colorCtx!.putImageData(new ImageData(data, cols, rows), 0, 0);
  return colorCanvas;
}

export function paintGlyphs({
  ctx,
  dpr,
  result,
  cellWidth,
  cellHeight,
  fill,
  useColors,
  rowOffset,
  rowAlpha,
  shadow,
}: PaintGlyphsArgs): void {
  const { rows, cols } = result;
  if (rows === 0 || cols === 0) return;

  const lines = result.text.split("\n").slice(0, rows);
  const advance = uniformAdvance(ctx, lines);
  const colorData = useColors ? result.colorData : undefined;

  if (advance === null) {
    paintPerCell(ctx, lines, result, cellWidth, cellHeight, fill, useColors, {
      rowOffset,
      rowAlpha,
      shadow,
    });
    return;
  }

  const spacing = `${cellWidth - advance}px`;

  if (!colorData) {
    const sctx = ctx as LetterSpacingContext;
    const prevSpacing = sctx.letterSpacing;
    sctx.letterSpacing = spacing;
    ctx.fillStyle = fill;
    if (shadow) {
      ctx.shadowBlur = shadow.blur;
      ctx.shadowColor = shadow.color;
    }
    for (let y = 0; y < rows; y++) {
      if (!lines[y]?.trim()) continue;
      if (rowAlpha) ctx.globalAlpha = rowAlpha(y);
      ctx.fillText(lines[y], rowOffset ? rowOffset(y) : 0, y * cellHeight);
    }
    ctx.globalAlpha = 1;
    if (shadow) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    }
    sctx.letterSpacing = prevSpacing ?? "0px";
    return;
  }

  // Per-cell colors via white rows + source-atop color bands.
  const cssW = cellWidth * cols;
  const cssH = cellHeight * rows;
  const { canvas: layerCanvas, ctx: lctx } = getLayer(
    Math.max(1, Math.round(cssW * dpr)),
    Math.max(1, Math.round(cssH * dpr)),
  );
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.font = ctx.font;
  lctx.textBaseline = ctx.textBaseline;
  lctx.textAlign = "left";
  (lctx as LetterSpacingContext).letterSpacing = spacing;
  lctx.fillStyle = "#fff";

  const colors = getColorImage(colorData, cols, rows);
  // 1px slack covers antialiasing at the glyph edges.
  const { inkTop, inkBottom } = getFontInfo(lctx);
  const bandTop = inkTop - 1;
  const bandHeight = inkBottom - inkTop + 2;
  const passes = Math.max(1, Math.ceil(bandHeight / Math.max(1, cellHeight)));

  for (let pass = 0; pass < passes && pass < rows; pass++) {
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, cssW, cssH);
    for (let y = pass; y < rows; y += passes) {
      if (!lines[y]?.trim()) continue;
      lctx.fillText(lines[y], rowOffset ? rowOffset(y) : 0, y * cellHeight);
    }
    lctx.globalCompositeOperation = "source-atop";
    lctx.imageSmoothingEnabled = false;
    for (let y = pass; y < rows; y += passes) {
      lctx.drawImage(
        colors,
        0,
        y,
        cols,
        1,
        rowOffset ? rowOffset(y) : 0,
        y * cellHeight + bandTop,
        cssW,
        bandHeight,
      );
    }
    lctx.imageSmoothingEnabled = true;
    lctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (shadow) {
      ctx.shadowBlur = shadow.blur * dpr;
      ctx.shadowColor = shadow.color;
    }
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }
}

/** Fallback for proportional fonts: one `fillText` per non-blank cell. */
function paintPerCell(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  result: ImageToAsciiResult,
  cellWidth: number,
  cellHeight: number,
  fill: string | CanvasGradient,
  useColors: boolean,
  {
    rowOffset,
    rowAlpha,
    shadow,
  }: Pick<PaintGlyphsArgs, "rowOffset" | "rowAlpha" | "shadow">,
) {
  const data = useColors ? result.colorData : undefined;
  if (shadow) {
    ctx.shadowBlur = shadow.blur;
    ctx.shadowColor = shadow.color;
  }
  let currentStyle: string | CanvasGradient | null = null;
  for (let y = 0; y < lines.length; y++) {
    const line = Array.from(lines[y]);
    const dx = rowOffset ? rowOffset(y) : 0;
    if (rowAlpha && !data) ctx.globalAlpha = rowAlpha(y);
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === " ") continue;
      let style: string | CanvasGradient = fill;
      if (data) {
        const p = (y * result.cols + x) * 4;
        style = `rgb(${data[p]}, ${data[p + 1]}, ${data[p + 2]})`;
      }
      // Assigning fillStyle re-parses the color; skip when unchanged.
      if (style !== currentStyle) {
        ctx.fillStyle = style;
        currentStyle = style;
      }
      ctx.fillText(ch, x * cellWidth + dx, y * cellHeight);
    }
  }
  ctx.globalAlpha = 1;
  if (shadow) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}
