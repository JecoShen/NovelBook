---
name: NeuroBook
description: The Editor's Desk — a local-first AI workspace for long-form Chinese web novelists, an 8-lamp writing room that takes long-form prose as seriously as code.
colors:
  paper-base: "#f4ecd8"
  paper-surface: "#fdf6e3"
  paper-edge: "#d6c7a9"
  paper-hover: "#e3d5b8"
  paper-input: "#ebe0c8"
  paper-sidebar: "#ebe0c8"
  paper-subtle: "color-mix(in srgb, #ebe0c8 78%, #fdf6e3)"
  ink-main: "#433422"
  ink-secondary: "#786450"
  ink-muted: "#b8a896"
  ink-inverse: "#ffffff"
  warm-accent: "#d97743"
  warm-accent-soft: "rgba(217, 119, 67, 0.15)"
  warm-accent-text: "#b85a2a"
  warm-accent-border: "color-mix(in srgb, #d97743 46%, #d6c7a9)"
  status-warning: "#b86b00"
  status-warning-soft: "rgba(184, 107, 0, 0.15)"
  status-warning-border: "rgba(184, 107, 0, 0.34)"
  status-success: "#6f7f35"
  status-success-soft: "rgba(111, 127, 53, 0.16)"
  status-success-border: "rgba(111, 127, 53, 0.38)"
  status-danger: "#a34d3f"
  status-danger-soft: "rgba(163, 77, 63, 0.13)"
  status-danger-border: "rgba(163, 77, 63, 0.34)"
  status-info: "#4f6f73"
  status-info-soft: "rgba(79, 111, 115, 0.14)"
  status-info-border: "rgba(79, 111, 115, 0.35)"
  editor-surface: "#fbf5e7"
  source-surface: "#fdf6e3"
  source-text: "#586e75"
  source-muted: "#93a1a1"
  shadow-base: "#0f172a"
  selection-warm: "rgba(217, 119, 67, 0.28)"
  toolbar-glass: "rgba(253, 246, 227, 0.92)"
  chat-ai-surface: "#f8efdc"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  body-prose:
    fontFamily: "Georgia, 'Times New Roman', Times, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.8
  body-sans-prose:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  mono-85:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "85%"
    fontWeight: 400
    lineHeight: 1.45
  label-caps:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  label-chip:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "0.58rem"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.8rem"
  card: "1rem"
  toast: "1rem"
spacing:
  chrome-bar: "48px"
  desktop-title: "36px"
  panel-pad-sm: "8px"
  panel-pad-md: "12px"
  panel-pad-lg: "16px"
  panel-pad-xl: "24px"
  section: "40px"
  dialog-gap: "16px"
components:
  button-primary:
    backgroundColor: "{colors.warm-accent}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-main}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "28px"
  button-danger-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.status-danger}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: "28px"
  status-chip-warning:
    backgroundColor: "{colors.status-warning-soft}"
    textColor: "{colors.status-warning}"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  status-chip-success:
    backgroundColor: "{colors.status-success-soft}"
    textColor: "{colors.status-success}"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  status-chip-danger:
    backgroundColor: "{colors.status-danger-soft}"
    textColor: "{colors.status-danger}"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  status-chip-info:
    backgroundColor: "{colors.status-info-soft}"
    textColor: "{colors.status-info}"
    rounded: "{rounded.xl}"
    padding: "2px 8px"
  reference-chip:
    backgroundColor: "color-mix(in srgb, currentColor 9%, {colors.paper-surface})"
    textColor: "{colors.ink-main}"
    rounded: "{rounded.xl}"
    padding: "1px 6px"
---

# Design System: The Editor's Desk

## Overview

**Creative North Star: "The Editor's Desk."**

NeuroBook is a long-form writer's room built like an editor's desk. The manuscript is the page. The world engine and the two-tree plot are the tools the editor reaches for without looking. The AI is a colleague sitting across the desk, not a stranger at a podium — it proposes, the author decides, and llmlint is the proofreader who quietly slips a red pencil in for every draft. The room is local-first: the desk is yours, the lights come on when you arrive, no one else sees the page.

The eight built-in themes are not eight rooms. They are eight lamps on the same desk — Sepia Paper for a late afternoon's first draft, Default Dark for the night-shift rewrite, Catppuccin or Tokyo Night for the focused proofread, Light Editorial for a morning when the author wants to share a screenshot. The 36 CSS variables stay constant; the lamp tilts. The desk doesn't move.

The mood is **calm and enduring**. This is software the author will live inside for hundreds of hours. Bright accents are reserved for moments that actually need to be loud (an unsaved draft, a danger confirm, the active selection). The default state is paper and ink, not pixels and gradients. Motion is 0.22s ease — quick enough to feel responsive, slow enough to read as a gesture, never as a flourish.

**Key Characteristics:**

- **Local-first, paper-first.** Sepia Paper is the SSR fallback and the unknown-theme default. The other seven themes are not the brand; they are concessions to circadian rhythm.
- **Status colors are roles, not accents.** `warning` / `success` / `danger` / `info` / `accent` are semantic — never decorative. The accent color is the one warm hue on the desk; status colors are the only thing allowed to push past it.
- **One room, one 36-variable contract.** No theme forks, no local overrides, no `dark:` branches. The runtime writes the 36 variables to `.novel-ide-theme`; everything reads from there.
- **Content colors are an exception, not a leak.** Reference chips (chapter / character / location / item / plot / etc.) are domain identification — fixed hex is acceptable. They do not enter the 36-variable set.
- **Ambient shadow, never theatrical.** Shadow exists to say "this surface is in front of that surface." It does not say "this is a hero element."

## Colors

The product is multi-theme by design, single-system by contract: every theme resolves the **same 36 variables** (`--bg-main` ... `--chat-ai-bg`). The values change; the names do not. The values are the canonical source — `app/utils/theme/theme-tokens.ts` for the runtime eight, `app/styles/theme-vars.css` for the SSR fallback (which always equals `themeTokens.sepia`).

**Sepia Paper is the canonical palette.** When in doubt — a new component, a new consumer, a new section — write to the Sepia Paper values. The other seven themes inherit the same 36 names; they are lamps, not dialects.

### Primary

- **Warm Accent** (`#d97743`, also `--accent-main`): the one warm hue on the desk. Used for the active sidebar item, the primary button, the selected chip border, the text-selection background. It is the only color allowed to feel "lit." Appears on at most 5–10% of any given screen; its rarity is the point.
- **Warm Accent — Soft** (`rgba(217, 119, 67, 0.15)`, also `--accent-bg`): the warm accent at 15% opacity. Used for selected-row backgrounds, soft prompt cards, gentle emphasis that should not compete with the text on top of it.
- **Warm Accent — Text** (`#b85a2a`, also `--accent-text`): the warm accent darkened. Used for links and emphasis inside body text where the full accent would overpower the sentence.
- **Warm Accent — Border** (`color-mix(in srgb, #d97743 46%, #d6c7a9)`, also `--border-accent`): the warm accent blended toward the edge color. Used for selected borders, focus rings on the accent path, and the active node outline in tree views.

### Status

Status colors are **roles**, not colors. The same hue family maps to different roles across the eight themes (Sepia's warning is amber, Dracula's warning is pale yellow); the role does not change. Pick by intent, not by name.

- **Warning** (`#b86b00` on Sepia, also `--status-warning`): draft, pending review, unsaved, diagnostic, placeholder. Use `--status-warning` for the text, `--status-warning-soft` for the chip background, `--status-warning-border` for the chip border.
- **Success** (`#6f7f35` on Sepia, also `--status-success`): complete, saved, synced, resolved, validated.
- **Danger** (`#a34d3f` on Sepia, also `--status-danger`): error, deletion, conflict, unrecoverable failure.
- **Info** (`#4f6f73` on Sepia, also `--status-info`): running, referenced, pending, neutral explanation.
- **Accent**: this is not a separate hue — it is the role of the warm accent when it represents "this is the active item." A selected row is `accent`, not `info`.

### Neutral — Paper & Ink

- **Paper Base** (`#f4ecd8`, also `--bg-main`): the desk surface. Used for the IDE canvas, the page background, the lowest layer.
- **Paper Surface** (`#fdf6e3`, also `--bg-panel`): the manuscript page. Used for cards, dialogs, main content panels.
- **Paper Sidebar** (`#ebe0c8`, also `--bg-sidebar`): the index-card drawer. Used for sidebars, directory trees, section rails.
- **Paper Subtle** (`color-mix(in srgb, #ebe0c8 78%, #fdf6e3)`, also `--bg-subtle`): the inside-of-the-drawer paper. Used for inset wells, soft nesting, content that sits inside a panel.
- **Paper Input** (`#ebe0c8`, also `--bg-input`): the form-field paper. Used for inputs, code shells, secondary containers.
- **Paper Hover** (`#e3d5b8`, also `--bg-hover`): the warm-up paper. Used for list-item hover, ghost-button hover, card hover.
- **Paper Edge** (`#d6c7a9`, also `--border-color`): the standard border. Used for borders, dividers, input strokes.
- **Paper Edge — Strong** (`#cfbc96`, also `--border-strong`): the strong border. Used for hover, focus, drag handles.
- **Ink Main** (`#433422`, also `--text-main`): the body ink. Used for body, headings, important content.
- **Ink Secondary** (`#786450`, also `--text-secondary`): the secondary ink. Used for summaries, subtitles, ordinary secondary information.
- **Ink Muted** (`#b8a896`, also `--text-muted`): the muted ink. Used for placeholders, weak hints, default icons, ordinals.
- **Ink Inverse** (`#ffffff`, also `--text-inverse`): the inverse ink. Used only on accent and status solid backgrounds (the warm-accent button, the danger confirm).

### Editor & Source

- **Editor Surface** (`#fbf5e7`, also `--editor-bg`): the long-form editor's paper. Used for the Markdown Studio / TipTap canvas and the preview pane.
- **Source Surface** (`#fdf6e3`, also `--source-bg`): the source-code paper. Used for code blocks, Monaco containers.
- **Source Text** (`#586e75`, also `--source-text`): the source-code ink. Used for code body, syntax foreground.
- **Source Muted** (`#93a1a1`, also `--source-muted`): the source-code muted. Used for line numbers, weak tokens, editor auxiliary information.

### Effects

- **Shadow Base** (`#0f172a`, also `--shadow-color`): the shadow ink. **Never** use a fixed shadow color anywhere — always `color-mix(in srgb, var(--shadow-color) 14%, transparent)` or similar. The shadow is the room's darkness; the room is always the same darkness, only the opacity moves.
- **Selection Warm** (`rgba(217, 119, 67, 0.28)`, also `--selection-bg`): the text-selection tint. Used by `.novel-ide-theme ::selection`.

### Component-Layer

- **Toolbar Glass** (`rgba(253, 246, 227, 0.92)`, also `--toolbar-bg`): the toolbar glass. Used for top toolbars, floating tool strips, light-transparency tool surfaces. A 92% opacity glass over the paper surface.
- **Chat AI Surface** (`#f8efdc`, also `--chat-ai-bg`): the AI-bubble paper. Used for the Agent AI bubble and AI output blocks. Slightly warmer than the editor surface so the AI voice reads as a different speaker.

### Reference Chip Categories (Content Color Exception)

These are domain identification, not status. They do not enter the 36-variable set. They are the only fixed hex that may appear in production code outside tests, because they identify *what kind of thing the chip is about*, not *what state the thing is in*.

| Category | Color (hex) | Use |
| --- | --- | --- |
| chapter | `#2563eb` | Chapter references in prose. |
| volume | `#7c3aed` | Volume references. |
| lorebook / character | `#0f766e` | Worldbuilding entries; people. |
| location / scene | `#0891b2` | Place references; scene anchors. |
| item / thread | `#c2410c` | Plot objects; running threads. |
| rule / plot | `#be123c` | World rules; plot-level links. |
| note / pending | `#6b7280` | Working notes; pending. |
| plan | `#4f46e5` | Planning-stage items. |
| file | `#475569` | File references. |
| selection | `#7c2d12` | Selected-span chips. |
| folder | `#b45309` | Folder references. |
| broken | `#dc2626` (line-through) | Broken links; tombstone chips. |

**The Reference Chip Rule.** The chip's category color appears as `currentColor` in the chip background, with a 9% mix into the paper surface and a 14%-into-transparent border. Vue / TipTap components emit only the semantic class (`is-chapter`, `is-character`, ...); appearance is owned by `app/styles/reference-chips.css`.

### Named Rules

- **The Same-Desk Rule.** Every theme resolves the same 36 variables. The 8 lamps never introduce a new variable; they only change the values of existing ones. If a feature needs a color that no variable covers, register the variable in `theme-tokens.ts`, do not hardcode it.
- **The Role-Not-Color Rule.** `warning` / `success` / `danger` / `info` / `accent` are roles, not names. Amber is a warning when it says "unsaved draft"; amber is an accent when it says "this is the active item." Pick by intent.
- **The No-Hardcode Rule.** No business component writes `bg-gray-100`, `text-amber-700`, `border-rose-500/30`, `dark:`, `bg-black/5`, or a fixed hex / rgba. The exception list is tests, the reference chip palette above, and external asset previews.
- **The Reference-Chip Exception.** The reference chip palette is the only domain-identification color set. It must not enter the 36-variable set, and it must not be used to color a status, a button, or a generic UI element.

## Typography

The product runs two typographic systems on the same desk: the **IDE chrome** (system sans) and the **long-form prose** (which can be system sans, serif, or any of the three content themes). The chrome never lets the prose system intrude on it; the prose is the user's stage.

**Display Font:** N/A — the IDE has no display. Hero / display typography is a chrome concern of the public site (`docs/`, `neuro-book-site`), not of the product.

**Body Font (IDE chrome):** system stack — `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif` at 0.9375 rem (15 px) with line-height 1.5.

**Body Font (prose):** either Georgia serif (Newsprint content theme) at 1 rem / 1.8 line-height, or system sans (Notion / GitHub content themes) at 1 rem / 1.6 line-height. The prose picks its own voice per chapter.

**Label Font:** system stack, 0.75 rem, weight 600, 0.08 em tracking, sometimes uppercase. Used for category labels, section headers inside chrome, and the caps on reference chips.

**Mono Font:** `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` at 0.875 rem (14 px) for the source code; at 85% (about 12.7 px) for inline code and code blocks. Both are paired with the source text / source muted ink.

**Label / Chip Mono:** 0.58 rem (about 9 px), weight 600, 0.08 em tracking, uppercase. The chip's badge and the small category label.

### Hierarchy

- **Body** (regular, 0.9375 rem, line-height 1.5): the default — every paragraph in the IDE.
- **Body Prose — Serif** (regular, 1 rem, line-height 1.8): the long-form reading voice. Newsprint content theme.
- **Body Prose — Sans** (regular, 1 rem, line-height 1.6): the long-form reading voice when sans is preferred. Notion and GitHub content themes.
- **Mono** (regular, 0.875 rem, line-height 1.5): source code in Monaco, paths, IDs.
- **Mono 85%** (regular, 85%, line-height 1.45): inline code, code blocks, fenced previews.
- **Label Caps** (semibold, 0.75 rem, 0.08 em tracking): section headers, dialog titles, field labels, status chip text.
- **Label Chip** (semibold, 0.58 rem, 0.08 em tracking): the reference chip badge and the smallest category callout.

### Named Rules

- **The Two-Desk Rule.** The IDE chrome and the long-form prose are two typographic systems that share a desk. Chrome is system sans; prose chooses its own voice (serif or sans) and is allowed to differ. Chrome never inherits the prose's serif.
- **The Mono-Source Rule.** Source code, paths, IDs, and any text that needs to be diff-able always use the mono stack. Body content never uses the mono stack.

## Layout

**The chrome is fixed; the workspace flows.**

- **Activity Bar (left rail) — 48 px fixed.** The shared navigation rail of the workspace. Holds 9 fixed slots: 书架 / 文件 / 角色 / 剧情 / World / Jobs/Trace/History / 用户资产 / 账户 / 设置. The Activity Bar is the same on Web and Desktop; the Desktop title bar sits above it on Desktop, not below.
- **Desktop Title Bar (top, Desktop only) — 36 px fixed.** A self-drawn workbench title bar with a full dropdown menu (File / Edit / View / Help). The B/S path does not draw a fake title bar — when `window.neuroBookDesktop` is absent, the page owns the full viewport.
- **Notification Viewport (overlay) — z-index 9800.** Lives outside the `.novel-ide-theme` host; reads the active theme's resolved snapshot directly. On Desktop, the viewport shifts down 36 px so notifications do not slide under the title bar.
- **Dialog** — 6 size presets: `sm` 360 px, `default` 420 px, `md` min(560, 100vw − 32), `lg` min(720, 100vw − 32), `xl` min(960, 100vw − 48), `full` min(1120, 100vw − 48). All heights bounded by `calc(100dvh − 80px)`. Dialogs teleport to `.novel-ide-theme` so they inherit the host's theme.
- **Resizable panels** — `useResizablePanel` composable. The host owns the persisted size; the panel emits `update:width` / `update:height` to the host on drag.
- **Spacing rhythm** — 8 / 12 / 16 / 24 / 40 px (panel-pad-sm / md / lg / xl, section). There is no 6 px and no 10 px; the rhythm is on a 4-px grid with 8 / 12 / 16 / 24 / 40 as the named steps.

## Elevation & Depth

**Ambient shadow, never theatrical.** Depth on the editor's desk is the difference between "this is on the desk" and "this has been picked up." It is not the difference between "this is a hero" and "this is a footnote."

**Shadow lives in one variable.** `--shadow-color` is the only shadow color. Every `box-shadow` is built from `color-mix(in srgb, var(--shadow-color) X%, transparent)`. There is no `rgba(15, 23, 42, ...)`, no `#000`, no `black` in a shadow.

**The canonical shadow values (in ambient spirit, not in literal pixels):**

- **Card lift** (hover, list-item hover, ghost-button hover): `0 8px 24px color-mix(in srgb, var(--shadow-color) 10%, transparent)`. Soft, low-opacity, says "the page is tilting toward you."
- **Dialog / panel lift** (overlay surfaces): `0 12px 32px color-mix(in srgb, var(--shadow-color) 12%, transparent)`. Says "this surface is in front of the page."
- **Notification / toast**: `0 14px 40px rgba(0, 0, 0, 0.22)`. The one shadow that ships a fixed rgba because the toast lives outside `.novel-ide-theme` and cannot read the host variable directly; this is a recorded exception, not a precedent.

**Surfaces layer with paper, not with paint.** `--bg-main` is the page, `--bg-panel` is the manuscript, `--bg-sidebar` is the drawer, `--bg-subtle` is the inside of the drawer, `--bg-input` is the form field, `--bg-hover` is the warm-up paper. The five backgrounds are the only layer cake; elevation is just the surface's position in the cake plus an optional ambient shadow.

### Named Rules

- **The Ambient-Only Rule.** Shadows exist to say "this is in front of that." They never say "this is important." If you want importance, use a status color or a typography change; do not increase the shadow.
- **The One-Color Rule.** All shadows use `--shadow-color` + `color-mix`. The single notification exception is documented and lives outside the theme host.
- **The No-Z-Stacking Rule.** Use a small set of `z-index` values — 9800 for notification viewport, the dialog overlay sits above page content but below notifications. No element invents its own z-index; values are registered in the design system.

## Shapes

The desk's geometry is the same: cards and inputs use small radii, the toast uses a larger radius, and the reference chip is a pill. There is no shape that varies by theme; the geometry is invariant.

- **Buttons and inputs** (the most-touched surfaces): `rounded-md` (6 px / 0.375 rem). Tight enough to read as a control, soft enough to read as a desktop element, not a web form.
- **Code blocks, code inline, small chips**: `rounded-sm` (4 px / 0.25 rem). The smallest radius on the desk; tight, code-feeling, never decorative.
- **Reference chips** (the category pill in prose): `rounded-xl` (0.8 rem). The pill radius — tall enough to read as a chip, not as a button.
- **Notification toast** (the one big surface): `rounded-card` (1 rem, equivalent to `rounded-2xl`). Soft, large, says "this is a temporary object on the desk."
- **Status chips** (the small state callouts): `rounded-xl` (0.8 rem). Same as reference chips — the pill is the universal small-element shape.
- **Dialogs**: no fixed radius registered; the dialog uses the chrome's default radius (6 px) and lets its content inherit the panel.

### Named Rules

- **The One-Radius-Per-Role Rule.** Each role picks one radius and stays there. Buttons are always 6 px. Reference chips are always 0.8 rem. Toasts are always 1 rem. Roles do not share radii.
- **The No-Shape-Theme Rule.** Shape is invariant. The eight lamps change color, never geometry.

## Components

### Activity Bar (left rail, 48 px)

- **Geometry:** 48 px wide, full height of the workspace, sits flush left.
- **Slot pattern:** nine fixed icon slots (the shared Activity Bar in `PROJECT-STATUS.md`). Each slot is a square with an icon centered; selected slot has the warm accent border on the left edge and the warm accent text.
- **Background:** `--bg-sidebar`. On hover, slots get `--bg-hover`.
- **Typography:** icon-only, 18–20 px; no labels by default. The label appears on hover as a tooltip.

### Desktop Title Bar (top, 36 px, Desktop only)

- **Geometry:** 36 px tall, full width, drawn only when `window.neuroBookDesktop` is truthy.
- **Menu surface:** File / Edit / View / Help. Native-style dropdowns; the renderer switches between native menu and renderer menu based on `status.menuPresentation`.
- **Window controls:** either native (Windows) or self-drawn (custom) based on `status.windowControls`. The renderer has both code paths.
- **Background:** `--toolbar-bg` (the 92% glass over paper). The title bar is a glass surface, not a solid bar.

### Dialog (overlay, 6 size presets)

- **Geometry:** `sm` 360 / `default` 420 / `md` 560 / `lg` 720 / `xl` 960 / `full` 1120, all bounded by `100dvh − 80 px` vertically. Rounded 6 px. Teleported to `.novel-ide-theme` so it inherits the host's variables.
- **Header:** default header; `showHeader=false` to suppress (workbench-style takeover). Title is 14–16 px semibold, `--text-main`.
- **Body:** consumes the panel surface; long bodies scroll independently.
- **Footer:** default footer with cancel + confirm; `showFooter=false` to suppress.
- **Overlay:** opaque (default) or transparent (workbench-internal). `closeOnOverlay` and `closeOnEsc` are both on by default; `busy` blocks both during a confirm-in-flight.
- **Shadow:** the dialog's `0 12px 32px color-mix(in srgb, var(--shadow-color) 12%, transparent)` is the canonical "this is in front of the page."

### Notification (toast)

- **Geometry:** `rounded-2xl` (1 rem), max-width 420 px, 4 px inset padding, 0.22 s ease for in/out.
- **Background:** theme snapshot's status background, with `backdrop-blur-sm` and the toast shadow `0 14px 40px rgba(0, 0, 0, 0.22)`.
- **Tone mapping:** `success` / `info` / `warning` / `danger` map to the status color family. The toast reads the active theme's snapshot, not the static CSS variables, because the toast lives outside the theme host.
- **States:** enter (translateY −8 px scale 0.98, opacity 0 → 1), leave (reverse), move (transform 0.22 s ease). All transitions are 0.22 s.
- **Content:** title (semibold, 14 px) + body (regular, 12 px) + close button (24 px, `--text-muted` → `--text-main` on hover). Body supports a small HTML subset via the client sanitizer (links, code, strong).

### Reference Chip (12 categories)

- **Geometry:** `0.04 rem × 0.38 rem` padding, `rounded-xl` (0.8 rem) — the pill. Max-width 24 rem with ellipsis on overflow.
- **Color:** the category color as `currentColor`, mixed at 9% into `--bg-panel` for the background and 14% into transparent for the border. The label and icon take `currentColor` directly.
- **Variants:** the 12 categories are the only variants. No new category color may be added without registering it in `app/styles/reference-chips.css` and `reference-chip.ts`.
- **Icon:** 0.8 rem square, opacity 0.88, takes `currentColor`.

### IconButton (the most-used chrome button)

- **Geometry:** 24 px (`sm`) or 28 px (`md`) square, `rounded-md` (6 px).
- **Default:** `--text-muted` icon, transparent background.
- **Hover:** `--bg-hover` background, `--text-main` icon.
- **Danger variant:** on hover, `--status-danger-bg` background and `--status-danger` icon — the only place the danger color appears as a button color.
- **Disabled:** opacity 0.45, `cursor-not-allowed`.

### Status Chip (the small state callout)

- **Geometry:** 2 px × 8 px padding, `rounded-xl` (0.8 rem), the small pill.
- **Color:** the role's `*-soft` background, the role's `*-border` border, the role's main text. Always a triplet (bg / border / text), never a single token.
- **Variants:** `warning` / `success` / `danger` / `info` / `accent`. The accent variant is a selected-state chip; the others are state callouts.

### Signature — the **Workbench Chrome** (the room)

The signature component is not a single visual element; it is the **Workbench Chrome contract** itself — the four-zone arrangement of 48 px Activity Bar + 36 px Desktop title bar + Notification viewport (z-9800) + Dialog overlay. The contract is what defines the product's surface area; the components inside it are interchangeable. Any new chrome surface (a side panel, a command palette, a settings overlay) participates in the contract by being told where it sits in the z-stack, which theme host it reads from, and which canvas it does not cover.

## Do's and Don'ts

### Do

- **Do** consume the 36 theme variables. Read the relevant `--bg-*` / `--text-*` / `--border-*` / `--accent-*` / `--status-*-*` / `--editor-*` / `--source-*` / `--shadow-color` / `--selection-bg` / `--toolbar-bg` / `--chat-ai-bg` token; do not write a Tailwind palette class, a `dark:` variant, or a fixed hex.
- **Do** pick status colors by intent. `warning` for unsaved / pending / diagnostic; `success` for complete / synced / resolved; `danger` for error / delete / conflict; `info` for running / pending / explanation; `accent` for selected / current / primary action.
- **Do** register a new theme variable in `theme-tokens.ts`, fill all 8 themes, sync `theme-vars.css` fallback, document the role in `app/utils/theme/README.md`. Then and only then consume it.
- **Do** mount World Engine surfaces inside `.world-engine-workbench-theme`. Use the `--we-*` aliases. Do not redefine `--we-*` in component scoped styles. Do not write `--bg-main: var(--we-bg-canvas)` reverse overrides.
- **Do** emit only the semantic class for reference chips (`is-chapter`, `is-character`, `is-location`, ...). The color is owned by `app/styles/reference-chips.css`.
- **Do** use `--shadow-color` + `color-mix(in srgb, var(--shadow-color) X%, transparent)` for every shadow. The single exception is the notification toast (which lives outside the theme host); that one is `0 14px 40px rgba(0, 0, 0, 0.22)`.
- **Do** keep 6 dialog size presets, in 100-dvh-bounded heights. Use the size prop, not ad-hoc width.
- **Do** draw the Desktop title bar (36 px) only when `window.neuroBookDesktop` is truthy. The B/S path does not draw a fake title bar.
- **Do** use `useResizablePanel` for any panel that the user resizes. The host owns the size; the panel emits `update:width` / `update:height`.
- **Do** route front-end API errors through `resolveApiErrorMessage(error, fallback)`. Use `useNotification()` for cross-entry, post-action, and post-dialog feedback. Use local `error` state for the form's own recoverable error.

### Don't

- **Don't** write Tailwind palette classes (`bg-gray-100`, `text-amber-700`, `border-rose-500/30`, ...) in business components. They are hardcoded colors and they break the contract.
- **Don't** write `dark:` variants. Light / dark is the theme's job, not the component's.
- **Don't** write `bg-black/5` or `bg-white/10` to fake depth on top of the paper surface. The 5 backgrounds are the layer cake; opacity stacking is not how depth is expressed.
- **Don't** write a fixed hex / rgba as a business color. The exception list is tests, the reference chip palette, the notification toast shadow, and external asset previews.
- **Don't** run-time concatenate UnoCSS variable class names. Write complete literal class names, e.g. `bg-[var(--status-warning-bg)]`, not `bg-${token}-bg`.
- **Don't** delete or bypass the `--we-*` World Engine alias layer. The aliases may be redirected, but the layer must remain.
- **Don't** put the Markdown content theme palette into the 36-variable set. The three content themes (GitHub / Newsprint / Notion) are a separate layer, scoped to `app/styles/markdown-themes.css`.
- **Don't** put the reference chip palette into the 36-variable set. Reference chips are domain identification, not theme state.
- **Don't** invent a new shadow color. The shadow base is `--shadow-color`; the variation is opacity.
- **Don't** add a new `z-index` value. Use the registered scale. Notification is 9800. If you need a new layer, register it in this file first.
- **Don't** claim a shadow is "important." Importance is a status color or a typography change, not a shadow.
- **Don't** ship visual evidence you did not verify. The product's `RELEASE.md` and `PROJECT-STATUS.md` already record what was tested; future work must not invent evidence that does not exist.
