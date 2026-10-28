import { strToU8, zipSync } from "fflate";
import { type ASCIIAppearance, hexToRgba } from "@/lib/ascii/ascii-config";

type ASCIIVideoExportParams = {
  appearance: ASCIIAppearance;
  fileName: string;
  fps: number;
  chars: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Called for each frame in order; never accumulates all frames in memory. */
  streamFrames: (
    onFrame: (
      text: string,
      colors: string[][] | undefined,
      frameIndex: number,
      total: number,
    ) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<void>;
  onProgress?: (pct: number) => void;
  onStage?: (label: string) => void;
  signal?: AbortSignal;
};

type ASCIIComponentExportParams = {
  appearance: ASCIIAppearance;
  fileName: string;
  fps: number;
  frames: string[];
  chars: string;
};

type ASCIIRenderMetrics = {
  charWidth: number;
  counterHeight: number;
  font: string;
  height: number;
  lineHeightPx: number;
  width: number;
};

export async function exportASCIIAnimationAsVideo({
  appearance,
  fileName,
  fps,
  chars,
  sourceWidth,
  sourceHeight,
  streamFrames,
  onProgress,
  onStage,
  signal,
}: ASCIIVideoExportParams) {
  throwIfAborted(signal);
  if (typeof MediaRecorder === "undefined") {
    throw new Error(
      "This browser does not support MediaRecorder video export.",
    );
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("The browser could not create a 2D canvas context.");
  }

  const exportAppearance = { ...appearance, showFrameCounter: false };
  const { mimeType, extension } = getSupportedVideoMimeType();

  if (!mimeType || !extension) {
    throw new Error("This browser cannot encode canvas output as video.");
  }

  // ── Phase 1: Collect all ASCII frames (no recording) ─────────────────────
  onStage?.("Capturing frames");
  onProgress?.(0);

  const collectedFrames: { text: string; colors: string[][] | undefined }[] =
    [];
  let metrics: ASCIIRenderMetrics | null = null;
  let yOffset = 0;

  await streamFrames(async (text, colors, frameIndex, frameTotal) => {
    throwIfAborted(signal);
    if (frameIndex === 0) {
      metrics = measureFrames(context, [text], exportAppearance);
      const sourceAspect = sourceWidth / sourceHeight;
      canvas.width = Math.ceil(metrics.width);
      canvas.height = Math.max(
        Math.ceil(metrics.height),
        Math.round(canvas.width / sourceAspect),
      );
      yOffset = Math.max(0, (canvas.height - metrics.height) / 2);
    }
    collectedFrames.push({ text, colors });
    onProgress?.(Math.round((frameIndex / frameTotal) * 55));
  }, signal);

  // Do not encode and download frames collected before cancellation.
  throwIfAborted(signal);

  if (collectedFrames.length === 0 || !metrics) {
    throw new Error("No frames were captured — load a file first.");
  }

  // ── Phase 2: Record at exact fps (fast canvas-only, no seeking) ───────────
  onStage?.("Encoding video");
  onProgress?.(55);

  const chunks: BlobPart[] = [];
  let blobResolve!: (b: Blob) => void;
  let blobReject!: (e: Error) => void;
  const blobPromise = new Promise<Blob>((res, rej) => {
    blobResolve = res;
    blobReject = rej;
  });

  const captureStream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(captureStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = () =>
    blobReject(
      new Error("Video export failed while recording the canvas stream."),
    );
  recorder.onstop = () => blobResolve(new Blob(chunks, { type: mimeType }));
  recorder.start();

  const frameDuration = 1000 / fps;
  const total = collectedFrames.length;
  const loopStart = performance.now();

  try {
    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const { text, colors } = collectedFrames[i];
      drawFrame({
        appearance: exportAppearance,
        canvas,
        context,
        frame: text,
        frameIndex: i,
        fps,
        metrics: metrics!,
        scale: 1,
        totalFrames: total,
        chars,
        colors,
        yOffset,
      });

      const targetMs = (i + 1) * frameDuration;
      const remaining = targetMs - (performance.now() - loopStart);
      if (remaining > 0) await wait(remaining, signal);

      onProgress?.(55 + Math.round((i / total) * 40));
    }

    onStage?.("Finalizing");
    onProgress?.(97);
    await wait(frameDuration, signal);
    throwIfAborted(signal);
    recorder.stop();
    const blob = await blobPromise;
    throwIfAborted(signal);
    onProgress?.(100);
    downloadBlob(blob, `${sanitizeFileStem(fileName)}.${extension}`);
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    captureStream.getTracks().forEach((track) => track.stop());
  }
}

export function exportASCIIAnimationAsReactComponent({
  appearance,
  fileName,
  fps,
  frames,
  chars,
}: ASCIIComponentExportParams) {
  if (frames.length === 0) {
    throw new Error("Convert a video first so there are frames to export.");
  }

  const stem = sanitizeFileStem(fileName);
  const componentName = toPascalCase(stem);
  const precroppedFrames = cropFrames(frames);
  const source = buildASCIIAnimationReactComponentSource({
    appearance: { ...appearance, showFrameCounter: false },
    componentName,
    fileStem: stem,
    fps,
    chars,
  });
  const framesJson = JSON.stringify(precroppedFrames);

  const zipFiles: Record<string, Uint8Array> = {
    [`${stem}.tsx`]: strToU8(source),
    [`${stem}-frames.json`]: strToU8(framesJson),
  };
  const zip = zipSync(zipFiles);
  downloadBlob(
    new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }),
    `${stem}.zip`,
  );
}

export async function exportASCIIAsImage({
  appearance,
  fileName,
  frame,
  colors,
  chars,
  quality = 2,
}: {
  appearance: ASCIIAppearance;
  fileName: string;
  frame: string;
  colors?: string[][];
  chars: string;
  quality?: number;
}) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("The browser could not create a 2D canvas context.");
  }

  const exportAppearance = { ...appearance, showFrameCounter: false };
  const metrics = measureFrames(context, [frame], exportAppearance);

  const scale = quality;
  canvas.width = Math.ceil(metrics.width * scale);
  canvas.height = Math.ceil(metrics.height * scale);

  drawFrame({
    appearance: exportAppearance,
    canvas,
    context,
    frame,
    frameIndex: 0,
    fps: 1,
    metrics,
    scale,
    totalFrames: 1,
    chars,
    colors,
  });

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });

  if (!blob) {
    throw new Error("Failed to generate image blob.");
  }

  downloadBlob(blob, `${sanitizeFileStem(fileName)}.png`);
}

export function exportASCIIAsJson({
  frames,
  fileName,
}: {
  frames: string[];
  fileName: string;
}) {
  if (frames.length === 0) {
    throw new Error("No frames to export.");
  }

  const payload = {
    version: 1 as const,
    frameCount: frames.length,
    frames,
  };
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(
    new Blob([json], { type: "application/json" }),
    `${sanitizeFileStem(fileName)}.json`,
  );
}

export function buildASCIIAnimationReactComponentSource({
  appearance,
  componentName,
  fileStem,
  fps,
  chars,
}: {
  appearance: ASCIIAppearance;
  componentName: string;
  fileStem: string;
  fps: number;
  chars: string;
}) {
  const appearanceJson = JSON.stringify(appearance, null, "\t");

  return [
    '"use client";',
    "",
    'import React, { useEffect, useLayoutEffect, useRef, useState } from "react";',
    `import FRAMES_JSON from "./${fileStem}-frames.json";`,
    "",
    `export const FPS = ${fps};`,
    `export const APPEARANCE = ${appearanceJson};`,
    `export const CHARS = ${JSON.stringify(chars)};`,
    "export const FRAMES = FRAMES_JSON as string[];",
    "",
    `export default function ${componentName}() {`,
    "\tconst [currentFrame, setCurrentFrame] = useState(0);",
    "\tconst [scale, setScale] = useState(1);",
    "\tconst [contentHeight, setContentHeight] = useState<number | null>(null);",
    "\tconst containerRef = useRef<HTMLDivElement>(null);",
    "\tconst contentRef = useRef<HTMLPreElement>(null);",
    "\tconst frameIndexRef = useRef(0);",
    "\tconst frames = FRAMES;",
    "",
    "\tuseEffect(() => {",
    "\t\tframeIndexRef.current = 0;",
    "\t\tif (frames.length <= 1) return;",
    "\t\tlet animationId: number;",
    "\t\tlet lastTime: number | null = null;",
    "\t\tlet accumulator = 0;",
    "\t\tconst frameDuration = 1000 / FPS;",
    "",
    "\t\tconst animate = (time: number) => {",
    "\t\t\tif (lastTime === null) lastTime = time;",
    "\t\t\tconst delta = time - lastTime;",
    "\t\t\tlastTime = time;",
    "\t\t\taccumulator += delta;",
    "",
    "\t\t\tif (accumulator >= frameDuration) {",
    "\t\t\t\tconst stepCount = Math.floor(accumulator / frameDuration);",
    "\t\t\t\taccumulator -= stepCount * frameDuration;",
    "\t\t\t\tconst nextFrame = (frameIndexRef.current + stepCount) % frames.length;",
    "\t\t\t\tif (nextFrame !== frameIndexRef.current) {",
    "\t\t\t\t\tframeIndexRef.current = nextFrame;",
    "\t\t\t\t\tsetCurrentFrame(nextFrame);",
    "\t\t\t\t}",
    "\t\t\t}",
    "",
    "\t\t\tanimationId = requestAnimationFrame(animate);",
    "\t\t};",
    "",
    "\t\tanimationId = requestAnimationFrame(animate);",
    "\t\treturn () => cancelAnimationFrame(animationId);",
    "\t}, [frames.length]);",
    "",
    "\tuseLayoutEffect(() => {",
    "\t\tconst measure = () => {",
    "\t\t\tconst container = containerRef.current;",
    "\t\t\tconst content = contentRef.current;",
    "\t\t\tif (!container || !content) return;",
    "",
    "\t\t\tconst availableWidth = container.clientWidth;",
    "\t\t\tconst naturalWidth = content.scrollWidth;",
    "\t\t\tconst naturalHeight = content.scrollHeight;",
    "",
    "\t\t\tif (availableWidth > 0 && naturalWidth > 0 && naturalWidth > availableWidth) {",
    "\t\t\t\tconst newScale = availableWidth / naturalWidth;",
    "\t\t\t\tsetScale(newScale);",
    "\t\t\t\tsetContentHeight(naturalHeight * newScale);",
    "\t\t\t} else {",
    "\t\t\t\tsetScale(1);",
    "\t\t\t\tsetContentHeight(null);",
    "\t\t\t}",
    "\t\t};",
    "",
    "\t\tmeasure();",
    "\t\tconst observer = new ResizeObserver(measure);",
    "\t\tif (containerRef.current) observer.observe(containerRef.current);",
    "\t\treturn () => observer.disconnect();",
    "\t}, [frames]);",
    "",
    "\tif (!frames.length) return null;",
    "",
    "\tconst effect = APPEARANCE.textEffect;",
    '\tconst needsStyles = effect !== "none";',
    "\tconst text = frames[currentFrame];",
    "",
    "\treturn (",
    "\t\t<div",
    "\t\t\tref={containerRef}",
    "\t\t\tstyle={{",
    "\t\t\t\tbackgroundColor: APPEARANCE.backgroundColor,",
    "\t\t\t\tborderRadius: `${APPEARANCE.borderRadius}px`,",
    "\t\t\t\tcolor: APPEARANCE.textColor,",
    '\t\t\t\tdisplay: "flex",',
    '\t\t\t\tflexDirection: "column",',
    "\t\t\t\tfontFamily: APPEARANCE.fontFamily,",
    '\t\t\t\toverflow: "hidden",',
    '\t\t\t\tposition: "relative",',
    '\t\t\t\twidth: "100%",',
    "\t\t\t\t...(contentHeight !== null ? { height: `${contentHeight}px` } : {}),",
    "\t\t\t}}",
    "\t\t>",
    "\t\t\t{needsStyles && (",
    "\t\t\t\t<style dangerouslySetInnerHTML={{ __html: `",
    "\t\t\t\t\t@keyframes ascii-rainbow { 0% { background-position: 0%; } 100% { background-position: 200%; } }",
    "\t\t\t\t\t@keyframes ascii-burn-neon { 0%, 100% { color: #ff3300; text-shadow: 0 0 20px #ff0000, 0 0 40px #ff3300; } 50% { color: #ffffff; text-shadow: 0 0 10px #ffffff, 0 0 20px #ffaa00; } }",
    "\t\t\t\t\t@keyframes ascii-neural-pulse { 0% { filter: hue-rotate(0deg); } 50% { filter: hue-rotate(180deg); } 100% { filter: hue-rotate(360deg); } }",
    "\t\t\t\t\t.ascii-effect-video { background-image: url('https://i.pinimg.com/originals/80/b7/5e/80b75eb774b647c67b2efa531b57ba13.gif'); background-size: cover; background-clip: text; -webkit-background-clip: text; color: transparent !important; }",
    "\t\t\t\t\t.ascii-effect-gradient { background-image: linear-gradient(45deg, #ff4c4c, #b3ff4c, #4c99ff, #4cc3ff, #b34cff); background-size: 200%; background-clip: text; -webkit-background-clip: text; color: transparent !important; animation: ascii-rainbow 5s linear infinite; }",
    "\t\t\t\t\t.ascii-effect-burn { animation: ascii-burn-neon 1.5s alternate infinite ease-in-out; }",
    "\t\t\t\t\t.ascii-effect-neural { animation: ascii-neural-pulse 3s linear infinite; text-shadow: 0 0 10px rgba(0, 100, 255, 0.5), 0 0 20px rgba(0, 50, 255, 0.3); }",
    "\t\t\t\t` }} />",
    "\t\t\t)}",
    "",
    '\t\t\t<div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>',
    "\t\t\t\t{APPEARANCE.showFrameCounter && (",
    '\t\t\t\t\t<div style={{ opacity: 0.5, fontSize: "10px", marginBottom: "8px" }}>',
    "\t\t\t\t\t\tFrame: {currentFrame + 1}/{frames.length}",
    "\t\t\t\t\t</div>",
    "\t\t\t\t)}",
    "\t\t\t\t<pre",
    "\t\t\t\t\tref={contentRef}",
    "\t\t\t\t\tstyle={{",
    '\t\t\t\t\t\tfontFamily: "inherit",',
    "\t\t\t\t\t\tfontSize: `${APPEARANCE.fontSize}px`,",
    "\t\t\t\t\t\tfontWeight: APPEARANCE.fontWeight,",
    "\t\t\t\t\t\tfontStyle: APPEARANCE.fontStyle,",
    "\t\t\t\t\t\tletterSpacing: `${APPEARANCE.letterSpacing}em`,",
    "\t\t\t\t\t\tlineHeight: APPEARANCE.lineHeight,",
    "\t\t\t\t\t\tmargin: 0,",
    '\t\t\t\t\t\twhiteSpace: "pre",',
    '\t\t\t\t\t\t...(effect === "matrix" && APPEARANCE.textEffectThreshold <= 0 ? {',
    '\t\t\t\t\t\t\tcolor: "#00ff00",',
    '\t\t\t\t\t\t\ttextShadow: "0 0 10px #00ff00, 0 0 20px #00ff00",',
    '\t\t\t\t\t\t} : effect === "neon" && APPEARANCE.textEffectThreshold <= 0 ? {',
    '\t\t\t\t\t\t\tcolor: "#ff00ff",',
    '\t\t\t\t\t\t\ttextShadow: "0 0 5px #ff00ff, 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ff",',
    '\t\t\t\t\t\t} : effect === "glitch" && APPEARANCE.textEffectThreshold <= 0 ? {',
    '\t\t\t\t\t\t\ttextShadow: "2px 0 0 red, -2px 0 0 blue",',
    "\t\t\t\t\t\t} : {}),",
    "\t\t\t\t\t}}",
    "\t\t\t\t>",
    "\t\t\t\t\t{(() => {",
    "\t\t\t\t\t\tconst threshold = APPEARANCE.textEffectThreshold;",
    "",
    '\t\t\t\t\t\tif (!text || effect === "none" || threshold <= 0 || !CHARS) {',
    "\t\t\t\t\t\t\treturn (",
    '\t\t\t\t\t\t\t\t<span className={effect === "none" ? "" : `ascii-effect-${effect}`}>',
    "\t\t\t\t\t\t\t\t\t{text}",
    "\t\t\t\t\t\t\t\t</span>",
    "\t\t\t\t\t\t\t);",
    "\t\t\t\t\t\t}",
    "",
    "\t\t\t\t\t\tconst thresholdIndex = Math.floor(CHARS.length * threshold);",
    "\t\t\t\t\t\tconst affectedChars = CHARS.slice(thresholdIndex);",
    "\t\t\t\t\t\tconst effectClass = `ascii-effect-${effect}`;",
    "",
    "\t\t\t\t\t\tconst effectStyle =",
    '\t\t\t\t\t\t\teffect === "matrix" ? { color: "#00ff00", textShadow: "0 0 10px #00ff00, 0 0 20px #00ff00" } :',
    '\t\t\t\t\t\t\teffect === "neon" ? { color: "#ff00ff", textShadow: "0 0 5px #ff00ff, 0 0 10px #ff00ff, 0 0 20px #ff00ff, 0 0 40px #ff00ff" } :',
    '\t\t\t\t\t\t\teffect === "glitch" ? { textShadow: "2px 0 0 red, -2px 0 0 blue" } :',
    "\t\t\t\t\t\t\t{};",
    "",
    "\t\t\t\t\t\tconst result = [];",
    '\t\t\t\t\t\tlet currentBatch = "";',
    "\t\t\t\t\t\tlet isBatchAffected = false;",
    "",
    "\t\t\t\t\t\tfor (let i = 0; i < text.length; i++) {",
    "\t\t\t\t\t\t\tconst char = text[i];",
    "\t\t\t\t\t\t\tconst isAffected = affectedChars.includes(char);",
    "",
    '\t\t\t\t\t\t\tif (isAffected !== isBatchAffected && currentBatch !== "") {',
    "\t\t\t\t\t\t\t\tresult.push(isBatchAffected ?",
    "\t\t\t\t\t\t\t\t\t<span key={i} className={effectClass} style={effectStyle}>{currentBatch}</span> :",
    "\t\t\t\t\t\t\t\t\tcurrentBatch",
    "\t\t\t\t\t\t\t\t);",
    '\t\t\t\t\t\t\t\tcurrentBatch = "";',
    "\t\t\t\t\t\t\t}",
    "\t\t\t\t\t\t\tcurrentBatch += char;",
    "\t\t\t\t\t\t\tisBatchAffected = isAffected;",
    "\t\t\t\t\t\t}",
    "",
    '\t\t\t\t\t\tif (currentBatch !== "") {',
    "\t\t\t\t\t\t\tresult.push(isBatchAffected ?",
    '\t\t\t\t\t\t\t\t<span key="final" className={effectClass} style={effectStyle}>{currentBatch}</span> :',
    "\t\t\t\t\t\t\t\tcurrentBatch",
    "\t\t\t\t\t\t\t);",
    "\t\t\t\t\t\t}",
    "",
    "\t\t\t\t\t\treturn result;",
    "\t\t\t\t\t})()}",
    "\t\t\t\t</pre>",
    "\t\t\t</div>",
    "\t\t</div>",
    "\t);",
    "}",
  ].join("\n");
}

function measureFrames(
  context: CanvasRenderingContext2D,
  frames: string[],
  appearance: ASCIIAppearance,
): ASCIIRenderMetrics {
  const normalizedFrames = frames.map(normalizeFrame);
  const maxColumns = normalizedFrames.reduce(
    (maxWidth, frame) =>
      Math.max(
        maxWidth,
        frame.reduce((rowWidth, row) => Math.max(rowWidth, row.length), 0),
      ),
    0,
  );
  const maxRows = normalizedFrames.reduce(
    (maxHeight, frame) => Math.max(maxHeight, frame.length),
    0,
  );
  const font = `${appearance.fontStyle} ${appearance.fontWeight} ${appearance.fontSize}px ${appearance.fontFamily}`;
  context.font = font;

  // Match preview exactly: ascii-canvas.tsx cellWidth = fontSize * 0.6 + letterSpacing (raw px)
  const charWidth = Math.max(
    1,
    appearance.fontSize * 0.6 + appearance.letterSpacing,
  );
  const lineHeightPx = Math.max(1, appearance.fontSize * appearance.lineHeight);
  const counterHeight = appearance.showFrameCounter
    ? appearance.fontSize * 2
    : 0;
  const width = Math.max(360, Math.ceil(maxColumns * charWidth));
  const height = Math.max(
    240,
    Math.ceil(counterHeight + maxRows * lineHeightPx),
  );

  return {
    charWidth,
    counterHeight,
    font,
    height,
    lineHeightPx,
    width,
  };
}

function drawFrame({
  appearance,
  canvas,
  context,
  frame,
  frameIndex,
  metrics,
  scale,
  totalFrames,
  colors,
  yOffset = 0,
}: {
  appearance: ASCIIAppearance;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  frame: string;
  frameIndex: number;
  fps: number;
  metrics: ASCIIRenderMetrics;
  scale: number;
  totalFrames: number;
  chars: string;
  colors?: string[][];
  yOffset?: number;
}) {
  const { width, height } = metrics;
  const effect = appearance.textEffect;
  const useColors = appearance.useColors && !!colors;
  const threshold = appearance.textEffectThreshold;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.fillStyle = appearance.backgroundColor;
  // Fill the full canvas (may be taller than content due to aspect-ratio letterboxing)
  context.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
  context.font = metrics.font;
  context.textBaseline = "top";
  context.shadowBlur = 0;
  context.shadowColor = "transparent";

  // ── Counter ──────────────────────────────────────────────────────────────
  let y = yOffset;
  if (appearance.showFrameCounter) {
    context.globalAlpha = 0.78;
    context.fillStyle = appearance.textColor;
    context.fillText(`Frame: ${frameIndex + 1}/${totalFrames}`, 0, y);
    context.globalAlpha = 1;
    y += metrics.counterHeight;
  }

  // ── Pre-compute effect fill (matches paintCells in ascii-canvas.tsx) ─────
  let effectFill: string | CanvasGradient = appearance.textColor;

  if (!useColors) {
    if (effect === "matrix") {
      effectFill = "#39ff14";
    } else if (effect === "gradient") {
      const g = context.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, "#7c3aed");
      g.addColorStop(0.5, "#06b6d4");
      g.addColorStop(1, "#22c55e");
      effectFill = g;
    } else if (effect === "burn") {
      const g = context.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#fde68a");
      g.addColorStop(0.6, "#f97316");
      g.addColorStop(1, "#7f1d1d");
      effectFill = g;
    } else if (effect === "neural") {
      const g = context.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, "#312e81");
      g.addColorStop(0.5, "#9333ea");
      g.addColorStop(1, "#22d3ee");
      effectFill = g;
    }
  }

  if (effect === "neon" && !useColors) {
    const glowBase = Math.max(2, metrics.lineHeightPx * 0.6);
    context.shadowBlur = glowBase * (1 + threshold * 2);
    context.shadowColor = appearance.textColor;
  }

  // ── Paint characters cell-by-cell (mirrors paintCells exactly) ───────────
  const rows = normalizeFrame(frame);
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    // Split by code point so astral glyphs occupy a single cell.
    const row = Array.from(rows[rowIdx]);
    const yPx = y + rowIdx * metrics.lineHeightPx;

    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const ch = row[colIdx];
      if (ch === " ") continue;

      const xPx =
        colIdx * metrics.charWidth +
        (effect === "glitch" &&
        (rowIdx + frameIndex) %
          Math.max(2, Math.round(11 * (1 - threshold * 0.8))) ===
          0
          ? (frameIndex % 7) - 3
          : 0);

      let fill: string | CanvasGradient;
      if (useColors && colors) {
        fill = colors[rowIdx]?.[colIdx] ?? appearance.textColor;
      } else if (effect === "video") {
        fill =
          rowIdx % 2 === 0
            ? appearance.textColor
            : hexToRgba(appearance.textColor, 0.7);
      } else {
        fill = effectFill;
      }

      context.fillStyle = fill;
      context.fillText(ch, xPx, yPx);
    }
  }

  if (effect === "neon") {
    context.shadowBlur = 0;
    context.shadowColor = "transparent";
  }

  // ── Overlay passes (mirrors paintEffectOverlay) ───────────────────────────
  if (effect === "video") {
    context.save();
    context.globalAlpha = 0.1 + threshold * 0.2;
    context.fillStyle = "#000";
    for (let scanY = 0; scanY < height; scanY += 3) {
      context.fillRect(0, scanY, width, 1);
    }
    context.restore();
  } else if (effect === "burn") {
    context.save();
    const intensity = 0.2 + threshold * 0.3;
    const grad = context.createRadialGradient(
      width / 2,
      height,
      height * 0.1,
      width / 2,
      height,
      height,
    );
    grad.addColorStop(0, hexToRgba("#dc2626", intensity));
    grad.addColorStop(1, hexToRgba(appearance.backgroundColor, 0));
    context.fillStyle = grad;
    context.fillRect(0, 0, width, height);
    context.restore();
  } else if (effect === "neural") {
    context.save();
    context.globalAlpha = 0.05 + threshold * 0.1;
    context.strokeStyle = "#22d3ee";
    context.lineWidth = 1;
    for (let lineX = 0; lineX < width; lineX += 24) {
      context.beginPath();
      context.moveTo(lineX, 0);
      context.lineTo(lineX, height);
      context.stroke();
    }
    context.restore();
  }
}

function normalizeFrame(frame: string) {
  return frame.replace(/\r/g, "").replace(/\n$/, "").split("\n");
}

function getSupportedVideoMimeType():
  | { mimeType: string; extension: string }
  | { mimeType: null; extension: null } {
  const candidates: Array<{ mimeType: string; extension: string }> = [
    { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" }, // H.264 baseline
    { mimeType: "video/mp4;codecs=avc1", extension: "mp4" }, // H.264
    { mimeType: "video/mp4;codecs=hvc1", extension: "mp4" }, // H.265
    { mimeType: "video/mp4", extension: "mp4" }, // MP4 any codec
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];

  return (
    candidates.find(({ mimeType }) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? { mimeType: null, extension: null }
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function sanitizeFileStem(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ascii-animation"
  );
}

function cropFrames(frames: string[]): string[] {
  let minCol = Infinity,
    maxCol = -Infinity;
  let minRow = Infinity,
    maxRow = -Infinity;

  for (const frame of frames) {
    const rows = frame.split("\n");
    for (let r = 0; r < rows.length; r++) {
      const row = Array.from(rows[r]);
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== " ") {
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
      }
    }
  }

  if (minCol === Infinity) return frames;

  return frames.map((frame) =>
    frame
      .split("\n")
      .slice(minRow, maxRow + 1)
      .map((row) =>
        Array.from(row)
          .slice(minCol, maxCol + 1)
          .join(""),
      )
      .join("\n"),
  );
}

function toPascalCase(value: string) {
  const normalized = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1));

  const joined = normalized.join("");

  return /^[A-Z]/.test(joined) ? joined : `Ascii${joined}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);

    const timer = window.setTimeout(done, duration);
    signal?.addEventListener("abort", abort, { once: true });

    function cleanup() {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }

    function done() {
      cleanup();
      resolve();
    }

    function abort() {
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    }
  });
}
