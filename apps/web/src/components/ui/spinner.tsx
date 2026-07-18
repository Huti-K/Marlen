import { Loader2, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one inline busy glyph — every spinner in the app is this, never a raw Loader2. */
export function Spinner({ className, ...props }: LucideProps) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} {...props} />;
}
