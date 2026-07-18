import { Mail } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Provider/app logo image, falling back to the generic mail glyph when no
 * image is given or it fails to load. Size via className (defaults to 16px).
 */
export function AppIcon({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={cn("h-4 w-4 shrink-0 object-contain", className)}
      />
    );
  }
  return <Mail className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)} />;
}
