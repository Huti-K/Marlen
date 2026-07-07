import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select styled like the other filled fields. */
export function Select({
  id,
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={cn("field h-9 w-full px-3 text-sm", className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
