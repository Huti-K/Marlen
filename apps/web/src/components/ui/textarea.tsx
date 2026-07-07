import * as React from "react";
import { cn } from "@/lib/utils";

// Borderless filled control — see `.field` in index.css.
export function Textarea({ className, ref, ...props }: React.ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      ref={ref}
      className={cn("field flex min-h-[60px] w-full px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}
