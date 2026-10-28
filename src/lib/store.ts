import { create } from "zustand";
import {
  ASCII_CHAR_PRESETS,
  DEFAULT_ASCII_APPEARANCE,
  type ASCIIAppearance,
} from "@/lib/ascii/ascii-config";
import type {
  AsciiDither,
  AsciiGlyphMapping,
} from "@/lib/ascii/ascii-converter";

export type StudioMode = "image" | "video" | "component";
export type SourceKind = "image" | "video" | "gif";

export interface StudioSource {
  kind: SourceKind;
  /** Live element used by the renderer. Not serializable — never sent to RSC. */
  el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  file: File | null;
  /** ObjectURL or http(s) URL backing `el`. */
  url: string;
  width: number;
  height: number;
  /** Defined only when `kind === "video"`. */
  durationMs?: number;
  /** Decoded frames for GIF sources. */
  gifFrames?: { canvas: HTMLCanvasElement; delayMs: number }[];
}

/** Tone / quantization settings forwarded to `imageToAscii`. */
export interface AsciiConversionSettings {
  contrast: number;
  gamma: number;
  autoLevels: boolean;
  dither: AsciiDither;
  glyphMapping: AsciiGlyphMapping;
  edges: boolean;
  edgeThreshold: number;
  samples: number;
}

export const DEFAULT_CONVERSION: AsciiConversionSettings = {
  contrast: 0,
  gamma: 1,
  autoLevels: false,
  dither: "none",
  glyphMapping: "shape",
  edges: false,
  edgeThreshold: 0.35,
  samples: 4,
};

export interface StudioState {
  source: StudioSource | null;
  appearance: ASCIIAppearance;

  columns: number;
  threshold: number;
  charset: string;
  charsetPresetId: string | null;
  invert: boolean;
  conversion: AsciiConversionSettings;
  responsiveFit: boolean;

  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  mode: StudioMode;

  setSource: (source: StudioSource | null) => void;
  clearSource: () => void;
  /** Merge a partial update into the current appearance. */
  patchAppearance: (patch: Partial<ASCIIAppearance>) => void;
  /** Replace appearance with defaults (Appearance section reset only). */
  resetAppearance: () => void;
  setColumns: (n: number) => void;
  setThreshold: (n: number) => void;
  setCharset: (chars: string) => void;
  setCharsetPreset: (id: string) => void;
  setInvert: (v: boolean) => void;
  /** Merge a partial update into the current conversion settings. */
  patchConversion: (patch: Partial<AsciiConversionSettings>) => void;
  setResponsiveFit: (v: boolean) => void;
  setMode: (mode: StudioMode) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setFrame: (frame: number) => void;
  stepFrame: (delta: number) => void;
  setTotalFrames: (n: number) => void;

  exportFilename: string;
  setExportFilename: (name: string) => void;
}

const DEFAULT_PRESET =
  ASCII_CHAR_PRESETS.find((preset) => preset.id === "terminal") ??
  ASCII_CHAR_PRESETS[0];

export const useAsciiStore = create<StudioState>((set) => ({
  source: null,
  appearance: DEFAULT_ASCII_APPEARANCE,

  columns: 130,
  threshold: -12,
  charset: DEFAULT_PRESET.chars,
  charsetPresetId: DEFAULT_PRESET.id,
  invert: false,
  conversion: DEFAULT_CONVERSION,
  responsiveFit: true,

  currentFrame: 0,
  totalFrames: 0,
  isPlaying: false,
  mode: "image",

  setSource: (source) =>
    set(() => ({
      source,
      currentFrame: 0,
      totalFrames:
        source?.kind === "video"
          ? Math.max(1, Math.round(((source.durationMs ?? 0) / 1000) * 24))
          : source?.kind === "gif"
            ? (source.gifFrames?.length ?? 0)
            : 0,
      isPlaying: false,
      mode:
        source?.kind === "video" || source?.kind === "gif" ? "video" : "image",
    })),

  clearSource: () =>
    set(() => ({
      source: null,
      currentFrame: 0,
      totalFrames: 0,
      isPlaying: false,
    })),

  // Simple spread — mergeASCIIAppearance always resets to DEFAULT base,
  // so we do the partial merge manually here to preserve current state.
  patchAppearance: (patch) =>
    set((state) => ({ appearance: { ...state.appearance, ...patch } })),

  resetAppearance: () =>
    set(() => ({ appearance: { ...DEFAULT_ASCII_APPEARANCE } })),

  setColumns: (n) => set(() => ({ columns: clampInt(n, 40, 300) })),
  setThreshold: (n) => set(() => ({ threshold: clamp(n, -100, 100) })),

  setCharset: (chars) =>
    set(() => ({
      charset: chars,
      charsetPresetId: matchPresetId(chars),
    })),

  setCharsetPreset: (id) =>
    set(() => {
      const preset = ASCII_CHAR_PRESETS.find((p) => p.id === id);
      if (!preset) return {};
      return { charset: preset.chars, charsetPresetId: preset.id };
    }),

  setInvert: (v) => set(() => ({ invert: v })),
  patchConversion: (patch) =>
    set((state) => ({ conversion: { ...state.conversion, ...patch } })),
  setResponsiveFit: (v) => set(() => ({ responsiveFit: v })),
  setMode: (mode) => set(() => ({ mode })),
  setPlaying: (playing) => set(() => ({ isPlaying: playing })),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setFrame: (frame) =>
    set((s) => ({
      currentFrame:
        s.totalFrames > 0 ? clampInt(frame, 0, s.totalFrames - 1) : 0,
    })),

  stepFrame: (delta) =>
    set((s) => ({
      currentFrame:
        s.totalFrames > 0
          ? clampInt(s.currentFrame + delta, 0, s.totalFrames - 1)
          : 0,
    })),

  setTotalFrames: (n) =>
    set((s) => ({
      totalFrames: Math.max(0, Math.floor(n)),
      currentFrame: Math.min(s.currentFrame, Math.max(0, Math.floor(n) - 1)),
    })),

  exportFilename: "",
  setExportFilename: (name) => set(() => ({ exportFilename: name })),
}));

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.round(clamp(n, min, max));
}

function matchPresetId(chars: string): string | null {
  return ASCII_CHAR_PRESETS.find((p) => p.chars === chars)?.id ?? null;
}
