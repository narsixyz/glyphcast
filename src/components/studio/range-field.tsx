"use client";

import { useState } from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn, formControlSlug } from "@/lib/utils";

/** Decorative tick dots, as fractions of the track. */
const TICKS = [0.25, 0.5, 0.75];

/** Inset (px) that keeps the thumb clear of the rounded ends. */
const EDGE_INSET = 8;

const FILL_CLASS = "bg-[#FCE6D4] dark:bg-[#B54B00]/25";

/**
 * Full-width "bar" slider: label on the left, value on the right, the filled
 * portion tinted in the brand color and a pill thumb at the fill edge. The
 * whole surface is draggable; keyboard + a11y come from the Radix primitive.
 *
 * Works controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
 */
export function RangeField({
  label,
  name,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
  className,
}: {
  label: string;
  /** Radix Slider hidden input; required for autofill / DevTools "id or name" audits. */
  name?: string;
  value?: number;
  defaultValue?: number;
  min: number;
  max: number;
  step: number;
  onChange?: (v: number) => void;
  /** Formats the value shown on the right. Defaults to the raw number. */
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  const fieldName = name ?? `studio-${formControlSlug(label)}`;

  return (
    <div
      className={cn(
        "group/range relative h-9 w-full overflow-hidden rounded-[10px] bg-[#F3F3F4] transition-colors select-none hover:bg-[#EEEEF0] dark:bg-zinc-800/70 dark:hover:bg-zinc-800",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {/* Fill under the left inset, so the bar reads as one continuous fill. */}
      <div
        aria-hidden
        className={cn("absolute inset-y-0 left-0", FILL_CLASS)}
        style={{ width: EDGE_INSET }}
      />
      {TICKS.map((t) => (
        <span
          key={t}
          aria-hidden
          className="absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C4C4CA] dark:bg-zinc-600"
          style={{
            left: `calc(${EDGE_INSET}px + (100% - ${EDGE_INSET * 2}px) * ${t})`,
          }}
        />
      ))}

      <SliderPrimitive.Root
        name={fieldName}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[current]}
        onValueChange={([v]) => {
          if (v === undefined) return;
          if (value === undefined) setInner(v);
          onChange?.(v);
        }}
        className="absolute inset-y-0 flex cursor-ew-resize touch-none items-center"
        style={{ left: EDGE_INSET, right: EDGE_INSET }}
      >
        <SliderPrimitive.Track className="absolute inset-0">
          <SliderPrimitive.Range
            className={cn("absolute inset-y-0", FILL_CLASS)}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-5 w-[5px] rounded-full bg-[#B54B00] shadow-[0_0_0_3px_rgba(181,75,0,0.18)] transition-[box-shadow,height] duration-150 outline-none group-hover/range:shadow-[0_0_0_4px_rgba(181,75,0,0.22)] focus-visible:shadow-[0_0_0_4px_rgba(181,75,0,0.4)] group-active/range:h-6" />
      </SliderPrimitive.Root>

      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center font-sans text-xs text-[#666] dark:text-zinc-400">
        {label}
      </span>
      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-xs tabular-nums text-[#111] dark:text-zinc-100">
        {format ? format(current) : current}
      </span>
    </div>
  );
}
