import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** The reveal-more affordance under a capped list — pairs with `usePagedVisible`. */
export function ShowMoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="sm" className="self-start" onClick={onClick}>
      <ChevronDown />
      {t("library.showMore", { count })}
    </Button>
  );
}
