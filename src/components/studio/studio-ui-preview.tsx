"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bold,
  ChevronDown,
  Film,
  Italic,
  Trash2,
  Upload,
} from "lucide-react";

import { ColorField } from "@/components/studio/color-field";
import { RangeField } from "@/components/studio/range-field";
import { useTheme } from "@/components/providers/theme-provider";
import ToggleButton from "@/components/shared/toggle-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import HeroFlower, {
  FPS,
  FRAMES as HERO_FRAMES,
} from "@/components/animations/hero-flower";
import { WindowTrafficLights } from "@/components/shared/window-traffic-lights";
import { BRAND_LOGO_RADIUS_CLASS, siteConfig } from "@/config/site";
import {
  STUDIO_CARD_OUTLINE,
  STUDIO_DROPZONE,
  STUDIO_FIELD_CLASS,
  STUDIO_FIELD_MONO_CLASS,
  STUDIO_FIELD_READONLY_MUTED,
  STUDIO_OUTLINE_TERTIARY,
  STUDIO_SELECT_CONTENT,
  STUDIO_SELECT_ITEM,
  STUDIO_SLIDER_CLASS,
  STUDIO_TEXT_LABEL,
  STUDIO_TEXT_META,
} from "@/lib/studio-theme";
import { cn, formControlSlug } from "@/lib/utils";

const HERO_MOCK_FRAME_COUNT = HERO_FRAMES.length;
const HERO_MOCK_SCRUB_MAX = Math.max(0, HERO_MOCK_FRAME_COUNT - 1);

const SIDEBAR_PANEL =
  "w-full shrink-0 rounded-3xl border border-[#E5E5E5] dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl shadow-black/6 dark:shadow-black/40 lg:w-[320px] lg:max-h-[680px] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]";

const PREVIEW_PANEL =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[#E5E5E5] dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl shadow-black/6 dark:shadow-black/40 max-lg:h-[min(62dvh,420px)] lg:h-[680px]";

const POINTER_HINT_CLASS = cn(
  "inline-flex w-fit max-w-full shrink-0 items-center gap-2 whitespace-nowrap overflow-hidden rounded-full border border-white/25 bg-gradient-to-r from-[#8F3D0C] via-[#B54B00] to-[#C75F18] px-3 py-1.5 font-sans text-[11px] font-normal normal-case tracking-normal text-white ring-1 ring-inset ring-white/10 dark:from-[#7A350A] dark:via-[#A34400] dark:to-[#B8520F]",
);

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className={cn("font-sans text-xs", STUDIO_TEXT_LABEL)}>
      {children}
    </span>
  );
}

function MiniDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2 pb-1">
      <span
        className={cn(
          "font-mono text-[9px] font-semibold uppercase tracking-widest",
          STUDIO_TEXT_LABEL,
        )}
      >
        {label}
      </span>
      <div className="h-px flex-1 bg-[#E5E5E5]/80 dark:bg-zinc-700/80" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function MockResetChip() {
  return (
    <Button
      type="button"
      variant="landing"
      size="sm"
      className="h-7 min-h-0 rounded-full px-3 py-0 font-mono text-[9px] font-semibold uppercase tracking-widest text-[#B54B00]"
    >
      Reset
    </Button>
  );
}

function MockAccordion({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[#E5E5E5]/70 dark:border-zinc-800/70 last:border-0">
      <header className="flex cursor-default items-center justify-between gap-2 px-4 py-3 select-none">
        <div className="flex items-center gap-2">
          <ChevronDown className="size-3.5 rotate-0 text-[#B54B00]/40 transition-transform duration-200" />
          <h3 className="font-sans text-xs font-semibold tracking-wide text-[#111] dark:text-zinc-100">
            {title}
          </h3>
        </div>
        <div>{action}</div>
      </header>
      <div className="overflow-visible">
        <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
      </div>
    </section>
  );
}

function MockTopBar() {
  return (
    <header
      suppressHydrationWarning
      className="flex h-14 shrink-0 items-center justify-between border-b border-[#E5E5E5] dark:border-zinc-800 bg-[#F9FAFC] dark:bg-zinc-950 px-6"
    >
      <div className="flex items-center gap-4">
        <div className="group flex shrink-0 items-center gap-2 md:gap-3">
          <Image
            src={siteConfig.logoPath}
            alt="Logo"
            width={32}
            height={32}
            unoptimized
            className={cn(
              "h-8 w-8 object-contain md:h-9 md:w-9",
              BRAND_LOGO_RADIUS_CLASS,
            )}
          />
          <div className="flex min-w-0 items-baseline gap-1.5 sm:gap-2">
            <span className="[font-family:var(--font-ascii-brand)] text-base font-medium tracking-wide whitespace-nowrap text-[#111] dark:text-zinc-100 md:text-lg">
              {siteConfig.productName}
            </span>
            <span className="hidden rounded-full border border-[#E5C4A5] dark:border-zinc-700 bg-[#FFF8F3] dark:bg-zinc-800 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#B54B00] sm:inline">
              Studio
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 font-satoshi text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
        <span className="hidden md:inline">Browser-Native</span>
      </div>
    </header>
  );
}

function MockSliderField({
  label,
  value,
  min,
  max,
  step,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
}) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const unit = display?.replace(/^[-\d.]+/, "") ?? "";
  return (
    <RangeField
      label={label}
      name={`landing-studio-${formControlSlug(label)}`}
      defaultValue={value}
      min={min}
      max={max}
      step={step}
      format={(v) => `${v.toFixed(decimals)}${unit}`}
    />
  );
}

export default function StudioUiPreview() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [autoFit, setAutoFit] = useState(true);
  const [invertMapping, setInvertMapping] = useState(false);
  const [autoLevels, setAutoLevels] = useState(false);
  const [edgeLines, setEdgeLines] = useState(false);
  const [useSourceColors, setUseSourceColors] = useState(false);
  const [showFrameCounter, setShowFrameCounter] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [mockPreviewFrame, setMockPreviewFrame] = useState(0);
  const heroFrameCountRef = useRef(HERO_MOCK_FRAME_COUNT);

  useEffect(() => {
    const frameCount = heroFrameCountRef.current;
    if (frameCount <= 1) return;
    let animationId: number;
    let lastTime: number | null = null;
    let accumulator = 0;
    const frameDuration = 1000 / FPS;

    const animate = (time: number) => {
      if (lastTime === null) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;
      accumulator += delta;

      if (accumulator >= frameDuration) {
        const stepCount = Math.floor(accumulator / frameDuration);
        accumulator -= stepCount * frameDuration;
        setMockPreviewFrame((prev) => (prev + stepCount) % frameCount);
      }

      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div
      tabIndex={0}
      className={cn(
        "mt-10 landing-content-width max-w-[1100px] cursor-default overflow-hidden rounded-3xl border font-satoshi shadow-[0px_4px_24px_rgba(0,0,0,0.06)] outline-none focus-visible:ring-2 focus-visible:ring-[#B54B00]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9FAFC] dark:focus-visible:ring-offset-zinc-950",
        isDark
          ? "border-zinc-800 bg-zinc-950"
          : "border-[#E5E5E5] bg-[#F9FAFC]",
      )}
    >
      <MockTopBar />

      <div className="grid grid-cols-1 gap-3 p-3 md:gap-4 md:p-4 lg:grid-cols-[320px_1fr]">
        <aside className={cn(SIDEBAR_PANEL, "hidden lg:block")}>
          <MockAccordion title="Source Media">
            <div className="group/dz relative w-full overflow-visible">
              <button
                type="button"
                className={cn(
                  "relative z-0 flex min-h-24 w-full cursor-default flex-col items-center justify-center gap-3 overflow-visible px-3 py-5 text-center",
                  STUDIO_DROPZONE,
                )}
              >
                <div className="flex flex-col items-center gap-3 transition-opacity group-hover/dz:opacity-25 group-focus-within/dz:opacity-25">
                  <Upload
                    className="h-3.5 w-3.5 shrink-0 text-[#B54B00]/80"
                    aria-hidden
                  />
                  <div className="space-y-1">
                    <p className="font-sans text-xs font-semibold text-[#111] dark:text-zinc-100">
                      Drop or browse
                    </p>
                    <p className="font-sans text-[10px] text-[#666] dark:text-zinc-500">
                      Image, GIF, or video · up to 30 MB
                    </p>
                  </div>
                </div>
              </button>
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-center px-3 opacity-0 transition-opacity duration-200",
                  "group-hover/dz:pointer-events-auto group-hover/dz:opacity-100",
                  "group-focus-within/dz:pointer-events-auto group-focus-within/dz:opacity-100",
                )}
              >
                <div
                  role="status"
                  className={POINTER_HINT_CLASS}
                  aria-label="Static preview. Open Studio to use the real uploader."
                >
                  <span className="text-[#FFECD9]/90">Static preview ·</span>
                  <Link
                    href={siteConfig.studioPath}
                    className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 font-semibold text-white hover:bg-black/25 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFECD9]"
                  >
                    Open Studio
                    <ArrowUpRight
                      className="size-3 shrink-0 text-[#FFF5EB]"
                      aria-hidden
                    />
                  </Link>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "flex items-center gap-3 rounded-lg bg-white dark:bg-zinc-800 p-2 pl-3",
                STUDIO_CARD_OUTLINE,
                "shadow-[0px_1px_2px_rgba(0,0,0,0.04)]",
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[#E5E5E5] dark:border-zinc-700 bg-[#F9FAFC] dark:bg-zinc-700 text-[#B54B00]">
                <Film className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-xs font-semibold text-[#111] dark:text-zinc-100">
                  Sample source
                </p>
                <p className="font-mono text-[10px] tabular-nums text-[#666] dark:text-zinc-500">
                  500 × 500
                </p>
              </div>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Remove source"
                className="flex size-7 shrink-0 cursor-default items-center justify-center rounded-sm text-[#888] transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            <Button
              type="button"
              variant="landingBlue"
              size="sm"
              className="h-8 w-full min-h-0 gap-2 rounded-full px-3 py-0 font-sans text-[11px] font-semibold tracking-wide"
            >
              Export ASCII
            </Button>
          </MockAccordion>

          <MockAccordion title="Canvas Settings">
            <Row label="Auto-Fit Screen">
              <ToggleButton toggle={autoFit} setToggle={setAutoFit} />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <FieldLabel>Width (Cols)</FieldLabel>
                <div
                  className={cn(
                    "flex items-center overflow-hidden rounded-md border border-[#E5E5E5] dark:border-zinc-700 bg-white dark:bg-zinc-800",
                    autoFit && "pointer-events-none opacity-50",
                  )}
                >
                  <span className="flex h-8 w-7 shrink-0 items-center justify-center border-r border-[#E5E5E5] dark:border-zinc-700 text-[#888] dark:text-zinc-400">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2 4.5h6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <input
                    id="landing-studio-canvas-columns"
                    name="landing-studio-canvas-columns"
                    type="text"
                    readOnly
                    className="h-8 w-full min-w-0 bg-transparent text-center font-mono text-xs tabular-nums text-[#111] dark:text-zinc-100 outline-none"
                    value={130}
                  />
                  <span className="flex h-8 w-7 shrink-0 items-center justify-center border-l border-[#E5E5E5] dark:border-zinc-700 text-[#888] dark:text-zinc-400">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M5 2v6M2 5h6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Height (Rows)</FieldLabel>
                <Input
                  id="landing-studio-canvas-rows-display"
                  name="landing-studio-canvas-rows-display"
                  type="text"
                  readOnly
                  className={STUDIO_FIELD_READONLY_MUTED}
                  value={72}
                />
              </div>
            </div>
          </MockAccordion>

          <MockAccordion title="Conversion" action={<MockResetChip />}>
            <div className="space-y-1.5">
              <MockSliderField
                label="Brightness"
                value={30}
                min={-100}
                max={100}
                step={1}
              />
              <MockSliderField
                label="Contrast"
                value={0}
                min={-100}
                max={100}
                step={1}
              />
              <MockSliderField
                label="Gamma"
                value={1}
                min={0.2}
                max={3}
                step={0.05}
                display="1.00"
              />
            </div>
            <Row label="Auto Levels">
              <ToggleButton toggle={autoLevels} setToggle={setAutoLevels} />
            </Row>

            <div className="space-y-2 pt-2">
              <div className="space-y-1.5">
                <FieldLabel>Character Set Mapping</FieldLabel>
                <p
                  className={cn(
                    "max-w-full text-[10px] leading-relaxed",
                    STUDIO_TEXT_META,
                  )}
                >
                  There are many built-in brightness ramps and styles, so the
                  menu is long scroll the list, or type your own sequence in the
                  field below. Muted gray in each row is a sample of the
                  character order (dark → light), not the preview&apos;s ink
                  color (set under Appearance).
                </p>
              </div>
              <Select
                name="landing-studio-conversion-charset-preset"
                defaultValue="terminal"
              >
                <SelectTrigger className={cn(STUDIO_FIELD_CLASS, "font-sans")}>
                  <SelectValue placeholder="Select preset…" />
                </SelectTrigger>
                <SelectContent
                  className={cn(
                    STUDIO_SELECT_CONTENT,
                    "max-h-[min(50dvh,280px)]",
                  )}
                >
                  <SelectItem value="terminal" className={STUDIO_SELECT_ITEM}>
                    <span className="font-semibold">Retro Terminal</span>
                    <span className="ml-2 font-mono text-[10px] text-[#666] dark:text-zinc-500">
                      .:-=+*#%@
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                id="landing-studio-conversion-charset"
                name="landing-studio-conversion-charset"
                readOnly
                spellCheck={false}
                autoComplete="off"
                className={STUDIO_FIELD_MONO_CLASS}
                value=" .,:;i1tfLCG08@"
              />
            </div>

            <Row label="Invert Mapping">
              <ToggleButton
                toggle={invertMapping}
                setToggle={setInvertMapping}
              />
            </Row>
            <div className="space-y-2">
              <FieldLabel>Glyph Matching</FieldLabel>
              <Select
                name="landing-studio-conversion-glyph-mapping"
                defaultValue="shape"
              >
                <SelectTrigger className={cn(STUDIO_FIELD_CLASS, "font-sans")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={STUDIO_SELECT_CONTENT}>
                  <SelectItem value="shape" className={STUDIO_SELECT_ITEM}>
                    Shape (sharpest)
                  </SelectItem>
                  <SelectItem value="measured" className={STUDIO_SELECT_ITEM}>
                    Density
                  </SelectItem>
                  <SelectItem value="linear" className={STUDIO_SELECT_ITEM}>
                    Charset order
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <MiniDivider label="Detail" />
            <div className="space-y-2">
              <FieldLabel>Dithering</FieldLabel>
              <Select
                name="landing-studio-conversion-dither"
                defaultValue="none"
              >
                <SelectTrigger className={cn(STUDIO_FIELD_CLASS, "font-sans")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={STUDIO_SELECT_CONTENT}>
                  <SelectItem value="none" className={STUDIO_SELECT_ITEM}>
                    None
                  </SelectItem>
                  <SelectItem
                    value="floyd-steinberg"
                    className={STUDIO_SELECT_ITEM}
                  >
                    Floyd–Steinberg
                  </SelectItem>
                  <SelectItem value="atkinson" className={STUDIO_SELECT_ITEM}>
                    Atkinson
                  </SelectItem>
                  <SelectItem value="ordered" className={STUDIO_SELECT_ITEM}>
                    Ordered (best for video)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <MockSliderField
              label="Sampling"
              value={4}
              min={1}
              max={8}
              step={1}
              display="4×"
            />
            <Row label="Edge Lines">
              <ToggleButton toggle={edgeLines} setToggle={setEdgeLines} />
            </Row>
            {edgeLines && (
              <MockSliderField
                label="Edge Sensitivity"
                value={0.65}
                min={0}
                max={0.95}
                step={0.01}
              />
            )}
          </MockAccordion>

          <MockAccordion title="Appearance" action={<MockResetChip />}>
            <MiniDivider label="Typography" />
            <div className="space-y-2">
              <FieldLabel>Font Family</FieldLabel>
              <Select
                name="landing-studio-appearance-font-family"
                defaultValue="jetbrains-mono"
              >
                <SelectTrigger className={cn(STUDIO_FIELD_CLASS, "font-sans")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={STUDIO_SELECT_CONTENT}>
                  <SelectItem
                    value="jetbrains-mono"
                    className={STUDIO_SELECT_ITEM}
                  >
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      JetBrains Mono
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Row label="Style & Weight">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={isBold}
                  onClick={() => setIsBold(!isBold)}
                  className={cn(
                    STUDIO_OUTLINE_TERTIARY,
                    "h-7 w-8 min-w-8 rounded-full border-[#D8D8D8] p-0",
                    isBold &&
                      "border-[#EBC6A5] bg-[#FFF5ED] text-[#7A3300] shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]",
                  )}
                >
                  <Bold className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={isItalic}
                  onClick={() => setIsItalic(!isItalic)}
                  className={cn(
                    STUDIO_OUTLINE_TERTIARY,
                    "h-7 w-8 min-w-8 rounded-full border-[#D8D8D8] p-0",
                    isItalic &&
                      "border-[#EBC6A5] bg-[#FFF5ED] text-[#7A3300] shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]",
                  )}
                >
                  <Italic className="size-3.5" />
                </Button>
              </div>
            </Row>

            <MockSliderField
              label="Font Size"
              value={10}
              min={4}
              max={24}
              step={0.5}
              display="10.0px"
            />
            <div className="space-y-1.5">
              <MockSliderField
                label="Line Height"
                value={0.95}
                min={0.5}
                max={1.6}
                step={0.01}
                display="0.95"
              />
              <MockSliderField
                label="Letter Spacing"
                value={0.04}
                min={-0.5}
                max={1}
                step={0.01}
                display="0.04"
              />
            </div>

            <MiniDivider label="Theme Colors" />
            <div className="space-y-1.5">
              <ColorField
                label="Background"
                value="#FFFFFF"
                onChange={() => {}}
                asRow
              />
              <ColorField
                label="Text"
                value="#B54B00"
                onChange={() => {}}
                asRow
              />
            </div>
            <Row label="Use Source Colors">
              <ToggleButton
                toggle={useSourceColors}
                setToggle={setUseSourceColors}
              />
            </Row>

            <MiniDivider label="Meta" />
            <Row label="Show Frame Counter">
              <ToggleButton
                toggle={showFrameCounter}
                setToggle={setShowFrameCounter}
              />
            </Row>
          </MockAccordion>
        </aside>

        <div className={PREVIEW_PANEL}>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {/* Header strip */}
            <div className="flex min-h-12 shrink-0 items-center gap-x-2 gap-y-2 border-b border-[#E5E5E5] dark:border-zinc-800 bg-[linear-gradient(180deg,#FFFFFF_0%,#F9FAFC_100%)] dark:bg-[linear-gradient(180deg,#18181b_0%,#18181b_100%)] px-3 py-2 sm:gap-x-3 sm:px-6 sm:py-0">
              <div className="flex shrink-0 items-center gap-2">
                <WindowTrafficLights />
              </div>

              <div className="ml-auto flex shrink-0 items-center">
                <span className="font-satoshi text-[11px] font-semibold uppercase tracking-[0.12em] text-[#888] dark:text-zinc-500">
                  Preview
                </span>
              </div>
            </div>

            {/* Stage */}
            <div className="flex min-h-0 flex-1 flex-col bg-[#F9FAFC] dark:bg-zinc-950 p-4">
              <div
                className={cn(
                  "relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-[#D4D4D4] bg-white shadow-[inset_0_1px_4px_rgba(0,0,0,0.06)]",
                  "dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.35)]",
                )}
              >
                <div className="flex h-full min-h-0 w-full items-center justify-center">
                  <HeroFlower
                    backgroundColor={isDark ? "#0B0B0D" : "#FFFFFF"}
                    controlledFrameIndex={mockPreviewFrame}
                  />
                </div>
              </div>
            </div>

            {/* Frame (mock video timeline) */}
            <div className="flex shrink-0 items-center gap-4 border-t border-[#E5E5E5] dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#888] dark:text-zinc-500">
                Frame
              </span>
              <Slider
                name="landing-studio-preview-frame-index"
                className={cn("flex-1", STUDIO_SLIDER_CLASS)}
                value={[mockPreviewFrame]}
                min={0}
                max={HERO_MOCK_SCRUB_MAX}
                step={1}
                onValueChange={([v]) =>
                  v !== undefined && setMockPreviewFrame(v)
                }
              />
              <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[#111] dark:text-zinc-100">
                {String(mockPreviewFrame + 1).padStart(3, "0")} /{" "}
                {String(HERO_MOCK_FRAME_COUNT).padStart(3, "0")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
