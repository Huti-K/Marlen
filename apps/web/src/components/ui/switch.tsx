import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";
import { cn } from "@/lib/utils";

// On-state colour by tone. `accent` is the default (the one spot of colour);
// `warning` marks a switch whose on-state arms something risky (e.g. the
// agent gaining permission to send or delete). Off is always the muted track.
const CHECKED_TONE = {
  accent: "data-[state=checked]:bg-accent",
  warning: "data-[state=checked]:bg-warning",
} as const;

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  tone?: keyof typeof CHECKED_TONE;
}

export function Switch({ className, tone = "accent", ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-muted-foreground/30",
        CHECKED_TONE[tone],
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-surface ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
