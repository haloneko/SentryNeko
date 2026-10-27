/** Text field drawn as a line to write on, with a settled state that shows the value as text. */

import { useId } from "react";

import lineInputStyles from "./LineInput.module.css";

export interface LineInputProps {
  /** Already translated; the caption above the line. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Already translated; what the empty line invites. */
  placeholder?: string;
  /** A glyph before the text, such as the `#` that marks a tag. */
  lead?: string;
  /**
   * Shows the value as text and retires the line: the caller has handed the value on and there is
   * nothing left to write. The line exists to write on, so it leaves with the writing.
   */
  locked?: boolean;
  /** Already translated; what a locked line with nothing on it reads instead of a blank. */
  emptyLabel?: string;
  /** Longest accepted text, mirroring whatever limit the value is stored under. */
  maxLength?: number;
  /** Id of the input; generated when the caller has no reason to name it. */
  id?: string;
  className?: string;
}

/** Renders the caption, the line and whatever is written on it. */
export function LineInput({
  label,
  value,
  onChange,
  placeholder,
  lead,
  locked = false,
  emptyLabel,
  maxLength,
  id,
  className = "",
}: LineInputProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className={`${lineInputStyles.line} ${className}`.trim()}>
      {locked ? (
        <p className={lineInputStyles.label}>{label}</p>
      ) : (
        <label className={lineInputStyles.label} htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className={lineInputStyles.field} data-locked={locked}>
        {lead === undefined ? null : (
          <span aria-hidden="true" className={lineInputStyles.lead}>
            {lead}
          </span>
        )}
        {locked ? (
          <p
            className={lineInputStyles.name}
            data-empty={value === ""}
            title={value === "" ? undefined : value}
          >
            {value === "" ? (emptyLabel ?? "") : value}
          </p>
        ) : (
          <input
            autoComplete="off"
            className={lineInputStyles.input}
            id={inputId}
            maxLength={maxLength}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            placeholder={placeholder}
            type="text"
            value={value}
          />
        )}
      </div>
    </div>
  );
}
