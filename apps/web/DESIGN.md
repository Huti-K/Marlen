# Trailin — Design Rules

The Trailin UI is **borderless neutral minimalism**. Think a quiet document, not a
dashboard. Structure comes from *space and surface tone*, never from lines. Color is a
scarce resource used for meaning, not decoration.

These rules are binding. If a change would break one, change the rule here first.

## The two hard constraints

1. **No borders, outlines, or strokes.** Nothing has a visible edge line at rest — no
   `border`, no `divide-*`, no outlined buttons, no ring at rest, no hairline dividers.
   Separation is achieved with surface tone and whitespace. (The one exception is the
   keyboard `:focus-visible` ring, which exists only for accessibility and only appears
   during keyboard navigation.)
2. **No card-in-card.** A surface is never nested inside another surface. Group content
   with a section heading + whitespace. If you need one elevated panel, it holds plain
   rows — not more panels.

## Surfaces — depth by tone, three levels only

| Token         | Role                                             | When to use                          |
| ------------- | ------------------------------------------------ | ------------------------------------ |
| `background`  | The canvas. Everything sits on it.               | Page body, main content column       |
| `surface`     | One step **up** (lighter in light, lighter in dark). | An elevated panel: composer, one grouped block |
| `surface-2` / `muted` | One step **down**, recessed.             | Inputs, chips, hover fills, list-row fills |

Never stack `surface` on `surface`. A grouped block is `surface`; the rows inside it are
bare or `surface-2` on hover — that is the maximum depth.

## Color

- **Ink is the brand.** Primary actions (buttons, the send control, the user's chat
  bubble) are near-black warm charcoal in light mode, near-white in dark mode. This is
  what reads as "premium and clean."
- **Slate blue is the single accent** (`accent`). It appears only on: the logo mark, the
  active nav item, links, the switch's on-state, and the focus ring. Never fill a large
  area with it.
- **Semantic colors are muted pastels**, used only for status: emerald = healthy/success,
  amber = attention/paused, red = destructive/error. Always low-chroma. Rendered as a
  pale tinted background + a darker text tone (see `Badge`).
- Body text is cool charcoal (`foreground`), never pure black. Secondary text is
  `muted-foreground`.

## Type

- **Geist Sans** for everything UI. **Geist Mono** for schedules, model ids, codes,
  timestamps — anything data-shaped (also gets `tabular-nums`).
- Hierarchy is built with **weight and color**, not size jumps. Section titles are
  `text-sm font-semibold`; their descriptions are `text-xs/text-sm text-muted-foreground`.
- Tighten tracking on headings (`tracking-tight`).

## Shape & elevation

- Radius: `--radius` (0.7rem ≈ 11px) for panels/inputs/buttons; smaller for chips. No
  `rounded-full` on containers or primary buttons — pills are reserved for status badges
  only.
- **Shadows are almost invisible.** Only elevated `surface` panels (composer, popover-like
  blocks) get a soft, low-opacity, warm-tinted shadow to lift them off the canvas without
  a line. Flat sections get none.

## Layout & motion

- Lead with macro-whitespace. Sections are separated by generous vertical gaps
  (`gap-8`/`gap-10`), not rules.
- Content column is constrained (`max-w-3xl` for settings-style pages).
- Motion is quiet: content rises `6px` and fades in over ~360ms; lists stagger. Animate
  only `transform`/`opacity`. Respect `prefers-reduced-motion`.

## Component conventions

- **Inputs / textareas / selects:** filled `surface-2`, no border, focus lightens the fill
  plus the a11y ring.
- **Buttons:** `default` = ink fill; `secondary`/`ghost` = subtle tonal fills; there is
  **no** outline variant (it maps to a tonal fill).
- **Badges:** pill, pastel tonal fill, no border.
- **Lists:** rows separated by spacing or a hover fill, never a divider line.
