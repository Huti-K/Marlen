import { ExternalLink } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";

/**
 * Ghost icon button that opens a URL outside the app — the one
 * open-in-provider affordance on cards, rows, and tiles.
 */
export function OpenExternalButton({
  url,
  label,
  size = "icon-xs",
  className,
}: {
  url: string;
  /** Accessible name; doubles as the hover tooltip. */
  label: string;
  size?: ButtonProps["size"];
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        openExternal(url);
      }}
      title={label}
      aria-label={label}
    >
      <ExternalLink />
    </Button>
  );
}
