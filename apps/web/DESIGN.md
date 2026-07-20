# Marlen — Design Rules

Borderless neutral minimalism: a quiet document, not a dashboard. Structure comes
from space and surface tone, never from lines. Color is scarce and means something.

Binding. To break a rule, change it here first. When a rule names an export, use
that export — a described effect gets reinvented, a named helper does not.

## The three hard constraints

1. **No borders, outlines, or strokes at rest.** No `border`, no `divide-*`, no
   outlined buttons, no hairline dividers. Separation is tone and whitespace.
   Four exceptions, and nothing else: the `:focus-visible` ring; `border-border`
   as a divider *inside* dense content (thread rails, markdown tables/blockquotes/
   hr, an expanded row's meta); `CardShell`, so agent work products read as
   discrete blocks on the white chat rail; and `.surface-pop`, because a
   scrimless panel over same-tone content has no other edge. Always the plain
   hairline, never with an opacity modifier.
2. **No card-in-card.** A surface is never nested in a surface. Group with a
   heading and whitespace. One elevated panel holds plain rows, not more panels.
3. **No drop shadows.** Nothing casts a blur, at rest or floating. Elevation is
   tone: the `.scrim` backdrop, and `.surface-pop`'s brighter dark-mode tone. The
   `--shadow-*` tokens are nulled in `index.css` so a stray utility renders
   nothing. Only the `:focus-visible` ring uses `box-shadow`, at zero blur.

## Component conventions

Reach for these before writing markup. A new primitive earns its place at two
clean call sites; when you add one, add it to this list.

- **Buttons:** `default` = accent fill (the CTA); `secondary`/`ghost` = tonal
  fills; `outline` is a tonal fill too, despite the name. Compact icon actions
  use `icon-sm`/`icon-xs` — never hand-roll `h-8 w-8` or restate ghost colors.
  Destructive row actions are `ghost-danger` + `Trash2`, one action one icon,
  whether the row is deleted or only moved to a terminal status. `X` is the
  non-destructive counterpart (close, clear) and stays `ghost`.
- **Spinners:** the shared `Spinner`. A busy button takes `loading` (which
  disables it and swaps its icon) — never a raw `Loader2` or a spin-class ternary.
- **Inputs / textareas / selects:** filled `surface-2`, no border; focus lightens
  the fill and adds the ring.
- **Badges:** pill, pastel tonal fill, no border.
- **Account dots:** `AccountDot` (`ui/account-dot.tsx`) — every round dot marker.
  Never hand-mix a dot fill or repeat `UNASSIGNED_ACCOUNT_COLOR`.
- **App logos:** `AppIcon` — provider logo with mail-glyph fallback.
- **Icon tiles:** `IconChip` — the tinted square fronting section titles and
  palette rows; it sizes the icon.
- **Section titles:** `SectionTitle` (`ui/section-header.tsx`) for every
  top-level page section; `SectionHeader`/`Section` for settings/setup pages.
- **Group labels:** `GroupLabel` — the uppercase muted overline over a group of
  rows; `sm` for dense meta lists.
- **Settings rows:** `SettingRow` — label+description left, control right; `bare`
  inside a raised card, `ListRow`-raised otherwise. Settings auto-save; secrets
  save on Enter/blur. The Pipedream credentials form is the one verify exception.
- **Menu/picker rows:** `OptionRow` — leading mark, truncated label, optional
  detail and trailing slot.
- **Row actions:** `HoverActions` (always visible below `sm`); external links use
  `OpenExternalButton`.
- **Filter chips:** `Chip` — ink fill when active, `surface-2` otherwise.
- **Search filters:** `SearchField` for every list filter box.
- **Show more/less:** `DisclosureToggle` (omit `open` for a one-way reveal);
  `ExpandButton` for a row's trailing chevron; paged lists use `usePagedVisible`
  + `ShowMoreButton`.
- **Notices:** `Notice` (`ui/feedback.tsx`) for inline status. No hand-rolled
  tint containers.
- **Empty states:** `EmptyState`.
- **Step marks:** `StepCircle`. **Keyboard hints:** `Kbd`.
- **Draft rows:** `SentRow`, `RefineInChatButton`, `EditSaveActions`
  (`components/draftActions.tsx`) — the shared parts of an approve/send row.
- **Icon verbs:** `.icon-send`/`.icon-discard`/`.icon-refine` move a glyph in its
  verb's direction on hover. Transform only, so hover never reflows.
- **Lists:** rows separated by spacing or a hover fill, never a divider.
- **Panel controls** are icon buttons in the panel header, never control rows in
  the content area. No suggestion/template chips.
- **Form actions** are right-aligned, primary rightmost.

## Surfaces

The canvas is true grey in both themes, so raised things lift and recessed things
sink. Standalone rises, tucked-inside sinks. That alternation is the whole model.

| Token | Role | Use for |
| --- | --- | --- |
| `surface` | **Raised** (white / lighter dark panel) | Anything standing on its own: a feed row, an empty state, a grouped block, an agent card |
| `background` | The canvas | Page body, main column, chat column |
| `surface-2` / `muted` | **Recessed** | Inputs, chips, hover fills, code blocks, anything inside a raised surface |

Never stack `surface` on `surface`. Sibling rows on the canvas each rise; rows
*inside* a grouped card stay bare. Raised holds recessed holds raised is the max
depth.

A neutral control's fill is relative to what is behind it, and this is automatic
via derived variables (`--surface-2-fill`, `--secondary-fill`). Use
`bg-surface-2`/`bg-secondary`/`.field`/`.tint-neutral`. Never hand-pick a grey to
make a control read; if contrast is short, fix the fill variables in `index.css`.

Anchored floating panels (select menus, color picker) use `.surface-pop`, not
`.surface`. Dialogs keep `.surface` — the scrim separates them.

## Color

- **Neutrals are true grey**, chroma 0, never tinted toward the accent.
- **Slate-violet is the single accent.** The CTA and the user's chat bubble are
  filled with it. Beyond that it marks only the logo, the nav rail's active item
  and hover tint, links, the switch's on-state, matched search text, and the
  focus ring. Never wash a panel or page in it.
- **Ink** (`--primary`) is the selected/pressed tone: the active `Chip`, the
  skip-link. Not a CTA fill.
- **Type tints on icon chips**, one tone per type, chip only, never the row
  background: accent = email draft, emerald = outbound message, amber =
  needs-attention, neutral = schedule/log. Section title chips reuse them.
- **Semantic colors are muted pastels**, status only: emerald = success, amber =
  attention/paused, red = destructive/error. Pale fill + darker text (see `Badge`).
- Body text is cool charcoal (`foreground`), never pure black; secondary is
  `muted-foreground`.

## Type

- **Geist Sans** for UI, **Geist Mono** for schedules, model ids, codes,
  timestamps (plus `tabular-nums`).
- Hierarchy is weight and color, not size jumps. Section titles are
  `text-sm font-semibold`, descriptions `text-xs`/`text-sm text-muted-foreground`.
- The ladder is `text-3xs` (10, tiny marks), `text-2xs` (11, meta/overline),
  `text-xs`, `text-sm`, `text-base`. There is no 13px step — resolve to `text-xs`
  or `text-sm`. Never write an arbitrary `text-[13px]`.
- Tighten tracking on headings (`tracking-tight`).

## Shape

Radius `--radius` (0.7rem) for panels/inputs/buttons, smaller for chips. No
`rounded-full` on primary buttons or in-flow containers — pills are for status
badges, filter chips, and tiny marks.

## Motion

- Content rises `6px` and fades over ~360ms. Animate only `transform`/`opacity`.
- **One easing curve**: `cubic-bezier(0.22, 1, 0.36, 1)`. Don't invent new ones.
- **Every animation needs a `prefers-reduced-motion` entry** in `index.css`'s
  reduce block. No exceptions.
- **List entrance:** `stagger(i)` (`lib/utils.ts`). It caps the delay so a long
  list still finishes inside the budget. Never hand-write `animationDelay`.
- **A list never snaps.** Rows that leave or move ride `withViewTransition` +
  `rowTransition(id)` (`lib/utils.ts`) so the list closes its own gaps.
  `rowTransition(id)` names the row; `withViewTransition` wraps the
  **synchronous** write — an `invalidateQueries` refetch lands too late to
  animate, so a row that must leave sets local state and lets the refetch
  reconcile behind it. A row reaching a **terminal state keeps its name**: the
  sent line carries the same `rowTransition(id)` as the live row, so sending
  morphs in place while discarding lets it go. The one outward, irreversible
  action must not read like a discard.
- **Route motion:** panel switches run through `withViewTransition` too (the
  sidebar `<Link>` and `select()` in `App.tsx`). `BrowserRouter` is not a data
  router, so react-router's `viewTransition` prop does nothing — drive it from
  the helper. Leave modified clicks (cmd/ctrl/shift/alt) to the browser. One
  duration for every group is what keeps a leaving row from outliving its canvas.

## State, loading, and failure

The UI is a function of live state, never of a page load. If seeing the new truth
needs a refresh, a remount, or reopening a panel, the wiring is wrong.

- Server data lives in TanStack Query, invalidated by its SSE topic; view state
  lives in React state or the URL. A key's first element is its topic.
- **Mutations reflect immediately.** The handler that writes also updates or
  invalidates the cache, so the row appears, changes, or leaves right away.
- **Loading:** `LoadingSweep` (`ui/feedback.tsx`) — one delayed accent strip on
  the canvas edge. Never a per-panel spinner for a refetch; a busy *control*
  takes `loading`. Refetches keep previous data on screen, never a blank flash.
- **Failure has one policy per shape, and silence is not one of them:**
  - A failed **panel fetch** renders `RetryableError` (`ui/feedback.tsx`).
  - A failed **user-initiated mutation** toasts.
  - An **inline form** shows its error in the form.
  - Never swallow a fetch whose result is a **baseline for a later write** — a
    write merged into an empty set silently destroys what it should have merged
    with. Refuse the write instead.
  - An **armed confirm dialog closes only on success.** Report the outcome from
    the persist call; a dialog that closes on failure claims work it didn't do.
- Sibling loaders in one file get the same policy. Two policies for one endpoint
  is a bug.

## Layers

Floating things stack in a fixed order. Pick the existing rung, don't invent one.

| z | Layer |
| --- | --- |
| `z-10`/`z-20` | Sticky headers and overlays inside a panel |
| `z-40` | Chrome scrim, splitter |
| `z-50` | App chrome (sidebar drawer), anchored panels (select, date picker) |
| `z-[100]` | Cursor tooltip |
| `z-[110]` | Modal scrim |
| `z-[120]` | Modal panel (dialog, palette) |
| `z-[130]` | Anchored panel opened above a modal |

Everything modal shares the `.scrim` backdrop: a light dim plus a **2px** blur —
the page stays readable through it, never frosted. Zones inside a floating panel
separate by tone, never by line (the palette footer is a recessed fill). Matched
text uses the same pale accent tint as `::selection`, so "found" and "selected"
read as one idea.

## Layout

- Lead with macro-whitespace; sections separate by `gap-8`/`gap-10`, not rules.
- Content column is constrained: `max-w-3xl` for settings-style pages, stepping to
  `max-w-4xl`/`max-w-5xl` via container queries — the canvas decides, not the
  viewport, since the sidebar and chat panel eat variable width.
- Chrome frames the canvas: the nav rail, chat column, and the frame behind the
  working canvas are `sidebar`. On desktop the grey canvas is inset and rounded
  (`rounded-2xl`); on mobile it runs edge to edge.
- Scrollbars are thin, trackless, rounded; `scrollbar-gutter: stable` wherever a
  list can grow.

## File size

`pnpm check` caps source files at 800 lines. Split by concern, in this order: the
row component, the form dialog, the data hook, then presentational helpers. A
panel that is a list plus a form is two files.
