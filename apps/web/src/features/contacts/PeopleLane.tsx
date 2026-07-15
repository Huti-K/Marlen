import { CONTACT_CATEGORIES, type Contact, type ContactCategory } from "@trailin/shared";
import { SearchX, Users } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { RetryableError } from "@/components/ui/feedback";
import { SearchField } from "@/components/ui/search-field";
import { ShowMoreButton } from "@/components/ui/show-more-button";
import {
  ContactAvatar,
  categoryLabel,
  LANE_INITIAL_VISIBLE,
  LANE_VISIBLE_STEP,
  LaneSkeletons,
  stagger,
} from "@/features/contacts/shared";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { useServerEvents } from "@/lib/serverEvents";
import { usePagedVisible } from "@/lib/usePagedVisible";
import { errorMessage } from "@/lib/utils";

/** The category filter row's one extra option, ahead of the five real categories. */
type CategoryFilter = ContactCategory | "all";

/**
 * People lane: search + category filter over kind="person" contacts
 * (server: email/contacts/). Selecting a row hands its address up to
 * ContactsPanel, which swaps this list for the detail view.
 */
export function PeopleLane({ onOpen }: { onOpen: (address: string) => void }) {
  const { t } = useTranslation();
  const [contacts, setContacts] = React.useState<Contact[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<CategoryFilter>("all");
  const { visible, showMore } = usePagedVisible(
    LANE_INITIAL_VISIBLE,
    LANE_VISIBLE_STEP,
    `${category}|${query}`,
  );
  // Guards against a slow, now-stale request overwriting a faster later one.
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(() => {
    const id = ++requestRef.current;
    api
      .contacts({
        kind: "person",
        category: category === "all" ? undefined : category,
        q: query.trim(),
      })
      .then((rows) => {
        if (requestRef.current !== id) return;
        setContacts(rows);
        setLoadError(null);
      })
      .catch((err) => {
        if (requestRef.current !== id) return;
        setLoadError(errorMessage(err));
      });
  }, [category, query]);

  // Debounced so fast typing doesn't fire one request per keystroke; a
  // category chip click resolves through the same path.
  React.useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  useServerEvents(["contacts"], refresh);

  if (contacts === null) {
    return loadError ? (
      <RetryableError onRetry={refresh}>{loadError}</RetryableError>
    ) : (
      <LaneSkeletons />
    );
  }

  const filtering = query.trim().length > 0 || category !== "all";
  // What the "no matches" empty state names as the thing that found nothing —
  // the typed query if there is one, else the active category chip's label.
  const filterDescription = query.trim() || (category !== "all" ? categoryLabel(t, category) : "");
  const shown = contacts.slice(0, visible);
  const remaining = contacts.length - shown.length;

  return (
    <div className="flex flex-col gap-4">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={t("contacts.searchPlaceholder")}
      />

      <div className="flex flex-wrap gap-1.5">
        <Chip active={category === "all"} onClick={() => setCategory("all")}>
          {t("contacts.category.all")}
        </Chip>
        {CONTACT_CATEGORIES.map((cat) => (
          <Chip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
            {categoryLabel(t, cat)}
          </Chip>
        ))}
      </div>

      {contacts.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={SearchX}
            title={t("common.noResults")}
            description={t("common.noResultsBody", { query: filterDescription })}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                {t("common.clearSearch")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title={t("contacts.emptyTitle")}
            description={t("contacts.emptyBody")}
          />
        )
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((contact, i) => (
            <div key={contact.address} className="animate-in-up" style={stagger(i)}>
              <PersonRow contact={contact} onOpen={() => onOpen(contact.address)} />
            </div>
          ))}
          {remaining > 0 && <ShowMoreButton count={remaining} onClick={showMore} />}
        </div>
      )}
    </div>
  );
}

function PersonRow({ contact, onOpen }: { contact: Contact; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const label = contact.displayName || contact.address;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-secondary"
    >
      <ContactAvatar label={label} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{label}</p>
          <Badge variant="muted" className="shrink-0 text-2xs">
            {categoryLabel(t, contact.category)}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{contact.address}</p>
        {contact.gist && (
          <p className="truncate text-xs text-muted-foreground/70">{contact.gist}</p>
        )}
      </div>
      <span className="shrink-0 text-2xs text-muted-foreground">
        {relativeTime(contact.lastContactAt, i18n.language)}
      </span>
    </button>
  );
}
