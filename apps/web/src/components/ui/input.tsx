import * as React from "react";
import { cn } from "@/lib/utils";

// Borderless filled control — see `.field` in index.css.
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn("field flex h-9 w-full px-3 py-1 text-base md:text-sm", className)}
      {...props}
    />
  );
}
