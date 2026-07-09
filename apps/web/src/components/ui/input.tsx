import * as React from "react";
import { cn } from "@/lib/utils";

// Borderless filled control — see `.field` in index.css.
// ComponentPropsWithRef, not InputHTMLAttributes: React 19 passes `ref` through
// as a plain prop, and callers need it to drive focus.
export function Input({ className, type, ...props }: React.ComponentPropsWithRef<"input">) {
  return (
    <input
      type={type}
      className={cn("field flex h-9 w-full px-3 py-1 text-base md:text-sm", className)}
      {...props}
    />
  );
}
