/** Controlled numeric field with an editable draft and shared stepping for every input method. */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import numericInputStyles from "./NumericInput.module.css";

export interface NumericInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "onWheel"
  > {
  value: number;
  /** Receives finite, bounded values; manual input aligns to the step from min (or zero). */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Positive increment; defaults to one. */
  step?: number;
  /** Already translated accessible names, including the field's name. */
  increaseLabel: string;
  decreaseLabel: string;
}

/** Decimal precision, including small steps written in scientific notation. */
function precision(value: number): number {
  const [coefficient = "", exponent = "0"] = String(value).split("e");

  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
}

/** Keeps decimal steps such as 0.1 from accumulating floating-point tails. */
function normalize(value: number, min: number, max: number, step: number): number {
  if (value <= min || value >= max) {
    return Math.min(max, Math.max(min, value));
  }

  const base = Number.isFinite(min) ? min : 0;
  const snapped = base + Math.round((value - base) / step) * step;
  const digits = Math.min(100, Math.max(precision(base), precision(step)));

  return Math.min(max, Math.max(min, Number(snapped.toFixed(digits))));
}

export function NumericInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  increaseLabel,
  decreaseLabel,
  disabled = false,
  readOnly = false,
  className = "",
  onBlur,
  onKeyDown,
  ...inputProps
}: NumericInputProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  const increment = Number.isFinite(step) && step > 0 ? step : 1;

  // Keep unfinished text when the parent echoes our change; replace it for an external update.
  if (draft.source !== value) {
    setDraft({ source: value, text: String(value) });
  }

  const publish = (next: number, text = String(next)): void => {
    if (!Number.isFinite(next)) {
      return;
    }

    setDraft({ source: next, text });
    if (next !== value) {
      onChange(next);
    }
  };

  const settle = (): void => {
    const parsed = draft.text.trim() === "" ? NaN : Number(draft.text);
    publish(Number.isFinite(parsed) && parsed !== value
      ? normalize(parsed, min, max, increment)
      : value);
  };

  const adjust = (direction: number): void => {
    if (disabled || readOnly) {
      return;
    }

    // A bound need not lie on the step grid: moving away still adds exactly one step.
    const digits = Math.min(100, Math.max(precision(value), precision(increment)));
    const next = Number((value + direction * increment).toFixed(digits));
    publish(Math.min(max, Math.max(min, next)));
  };

  const wheel = useEffectEvent((event: WheelEvent) => {
    if (
      disabled || readOnly || event.ctrlKey || event.metaKey || event.deltaY === 0 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ) {
      return;
    }

    event.preventDefault();
    adjust(event.deltaY < 0 ? 1 : -1);
  });

  useEffect(() => {
    const control = controlRef.current;
    if (!control) {
      return;
    }

    // React's wheel listener is passive, so it cannot stop the settings page scrolling too.
    const listener = (event: WheelEvent): void => wheel(event);
    control.addEventListener("wheel", listener, { passive: false });
    return () => control.removeEventListener("wheel", listener);
  }, []);

  return (
    <div className={numericInputStyles.numericInput} data-disabled={disabled} ref={controlRef}>
      <input
        {...inputProps}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuenow={value}
        className={`${numericInputStyles.numericInputField} ${className}`.trim()}
        disabled={disabled}
        inputMode="decimal"
        onBlur={(event) => {
          if (!disabled && !readOnly) {
            settle();
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          const text = event.target.value;
          // Allow temporary blanks, signs and decimal points while rejecting nonnumeric paste.
          if (!/^[+-]?\d*(?:\.\d*)?$/.test(text)) {
            return;
          }

          const parsed = text.trim() === "" ? NaN : Number(text);
          if (Number.isFinite(parsed)) {
            publish(normalize(parsed, min, max, increment), text);
          } else {
            setDraft({ source: value, text });
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || disabled || readOnly) {
            return;
          }

          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            adjust(event.key === "ArrowUp" ? 1 : -1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            settle();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft({ source: value, text: String(value) });
          }
        }}
        readOnly={readOnly}
        ref={inputRef}
        role="spinbutton"
        type="text"
        value={draft.text}
      />
      <div className={numericInputStyles.numericInputButtons}>
        {[
          { direction: 1, label: increaseLabel, limit: value >= max },
          { direction: -1, label: decreaseLabel, limit: value <= min },
        ].map(({ direction, label, limit }) => (
          <button
            aria-label={label}
            className={numericInputStyles.numericInputButton}
            disabled={disabled || readOnly || limit}
            key={direction}
            onClick={() => {
              adjust(direction);
              inputRef.current?.focus();
            }}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <path d={direction === 1 ? "m3 7 3-3 3 3" : "m3 5 3 3 3-3"} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
