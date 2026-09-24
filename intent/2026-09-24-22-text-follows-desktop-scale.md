---
status: approved
issue: 22
author: olafkfreund
---

# Intent: menu text should follow the desktop's text size

## Problem

The desktop already has one control for how big text is: `[font] base-size`
in `~/.config/omarchy/shell.toml`, set by `omarchy display text size <9-20>`.
Every `Style.font.*` token is `round(base-size × multiplier)`, and
`Style.space()` scales by the same factor, so a surface built from those
tokens tracks the setting on its own and re-flows live.

This plugin multiplies them by a further flat **1.45** in the menu. So the
menu is 45% larger than the rest of the shell at *every* text size, and the
user's setting moves it up and down without ever making it agree with the
surfaces around it.

Note what this is **not**: monitor scale is applied by the compositor, and QML
sizes are logical pixels, so the 1.45 is not double-applying a monitor scale.
It stacks on the *text-size* setting only.

Issue #21 fixed the mechanism — the factor used to be a `scale:` transform
that magnified the view after layout, and is now a layout-time `px()`
multiplier, which is why text reflows correctly and the caps follow the
screen. This task removes the remaining flat factor. #21 makes that
contained: every size already flows through one `px()` per file.

`nixarchy-flatsnap` has already done this (its #9, merged as its PR #14): no
flat multiplier, and the menu stays larger by using a **bigger `Style.font`
token** rather than a factor. Its current `main` has no `textScale` or `px()`
at all.

**A correction worth recording**, because it misled #21: the `/nix/store`
builds of `nixarchy-flatsnap` and `nixarchy-pkg` on this machine predate that
fix and still contain `textScale: 1.45` and `px()`. #21's spec cited them as
the reference for keeping the constant. They are stale. Read a sibling's
GitHub `main`, not whatever build happens to be in the store.

## Proposed outcome

- Changing `omarchy display text size` moves the menu in step with the rest of
  the shell, at every setting, rather than always 45% above it.
- The full-screen menu is still comfortably larger than the bar popup, because
  it is read from further away — but by a scale-aware step, not a factor.
- A theme that pins a font token in `shell.toml` is honoured by the menu, which
  a multiplier silently overrode.
- The factor cannot come back unnoticed.

## Affected users and systems

Anyone who has changed their desktop text size, and anyone on a theme that
pins font tokens. Touches `Menu.qml` and the five drawing files
(`DistroboxView`, `BoxList`, `CreateForm`, `LogView`, `ShortcutSheet`), which
today hold 42 `px(Style.font.*)` sites, 25 `px(Style.space(…))` and 39
`px(Style.spacing.*)`. `Panel.qml` passes no factor and should stay
unchanged. No change to `Model.js`, to any argv, or to the host-quoting
surface.

## Constraints

- **The bar popup must not change.** It is read from close up and already sits
  at base tokens.
- Sizes keep going through `Style.*` tokens — no raw pixel literals, so the
  existing rules still hold.
- The menu must stay visibly bigger than the popup. Simply deleting the factor
  with no replacement would make the two surfaces identical, which is not the
  intent.
- Keep the wins from #21: text must still reflow at its drawn size, and the
  caps must still follow the screen. Whatever replaces the factor must not
  reintroduce a `scale:` transform.
- Both surfaces are keep-loaded, so sizing must survive close and reopen.
- The five nixarchy menus should end up the same size as each other; this is
  the shared convention, not a local preference.

## Open questions

1. **How does the menu stay bigger without a factor?** Flatsnap moved each
   site up the ladder by hand (`caption` → `title`, `subtitle` → `heading`).
   This plugin has two surfaces sharing one component tree, so a per-site
   constant cannot differ between them. Does the view take a "step" the host
   chooses (popup one rung, menu another), or does it always use the larger
   tokens and the popup shrink to match?
2. **What happens to the 64 spacing and space sites?** Flatsnap left geometry
   alone. Dropping the multiplier there shrinks the menu's card and rows as
   well as its text. Is that wanted, or should geometry keep a factor while
   only text becomes token-driven?
3. **Which tokens?** Today's most-used is `caption` (24 of 42 sites); at 1.45
   that renders 15px at the default base-size, and the nearest scale-aware
   token is `title` (14px). Body at 1.45 is 17px, between `heading` (16) and
   `display` (24). Some rounding down is unavoidable — is that acceptable, as
   it was for flatsnap?
4. **Should the guard be copied?** Flatsnap added a `no-text-multiplier` flake
   check that fails on `textScale`, `uiScale`, `px(` or a `pixelSize:` that is
   not a `Style.font.*` token. Worth having here, and should it cover all six
   files rather than just `Menu.qml`?
