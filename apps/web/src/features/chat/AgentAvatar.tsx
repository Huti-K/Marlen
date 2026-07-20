import { cn } from "@/lib/utils";

/**
 * The assistant's face: the Marlen mark in white on a solid accent circle,
 * fronting assistant turns and the empty chat so a reply reads as coming from
 * someone. The mark is `/logo.svg` applied as a mask over the chip's
 * foreground color, so it always tracks the shipped brand asset. `active`
 * lights the bloom behind the chip while the turn is live.
 */
export function AgentAvatar({
  active = false,
  size = "sm",
  className,
}: {
  active?: boolean;
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "agent-avatar bg-accent text-accent-foreground",
        active && "agent-avatar-active",
        size === "lg" ? "h-14 w-14" : "h-7 w-7",
        className,
      )}
    >
      <span className="agent-avatar-mark h-3/5 w-3/5" />
    </span>
  );
}
