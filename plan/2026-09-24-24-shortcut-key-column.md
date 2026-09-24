---
status: draft
issue: 24
spec: spec/2026-09-24-24-shortcut-key-column.md
---

# Plan: the key column grows to fit its keys

## The approved decisions, carried over

**The problem.** A QML `Text` paints its full content past `width` unless
`elide` or `clip` is set. `ShortcutSheet.qml`'s `entryKeys` has a fixed
`width: Style.space(90)` and neither, while `entryText` anchors to
`entryKeys.right` — so a key string wider than the column paints over the
description that starts where the column *says* it ends. Exactly one entry is
long enough today: `"tab  ↓ / shift+tab  ↑"` at 21 characters, against a
next-longest of 9. Pre-existing, not a regression from #21 or #22.

**The approved fix: widen.** `width: Math.max(Style.space(90), implicitWidth)`.
The token stays the floor so short rows keep today's alignment, and both sides
scale with `[font] base-size`, so it holds at any text size.

**Rejected, with reasons:** eliding or clipping the keys (a key you cannot
read is worse than a ragged row — `tab  ↓ / shift+ta…` tells nobody what to
press); a per-group column (gives "Create form" a 21-character gutter for its
three short rows, and needs a width computed across a Repeater's model);
shortening the entry in `SHORTCUTS` (treats the symptom, loses the arrow
hints, and the next long entry brings it back).

**Accepted cost:** one row's description starts further right than its
neighbours'. **Ceiling:** the column grows unbounded, so a key wider than the
sheet would squeeze the description to nothing — far off at 21 characters
against a `Style.space(680)` card, but it is the limit.

## Steps

1. **`ShortcutSheet.qml`: widen `entryKeys`** to
   `Math.max(Style.space(90), implicitWidth)`, with a comment saying why the
   keys are not elided and that the token is the floor.
   → verify by grep, and by `nix flake check` still passing
   `no-text-multiplier` (this edits a sizing line).

2. **Runtime verification** on razer — see Tests.

Two commits, each citing the step and `(#24)`. No `Model.js` change, so no
new tests: the defect is a layout property, not logic.

## Tests

```bash
node tests/run.js                 # 103, unchanged -- Model.js untouched
nix flake check                   # incl. #22's no-text-multiplier
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

Runtime, on razer, installed as a real copy per AGENTS.md. **Check first that
no peer session is driving that desktop** (`ListAgents`, and look for a
foreign `nixarchy-*-menu` layer); run the whole sequence in **one** ssh
invocation, because the menu layer has closed between separate ones.

1. **The bug is fixed.** Open `?` in the full-screen menu, capture, and read
   the "Create form" group: `tab  ↓ / shift+tab  ↑` and `Next / previous
   field` must not overlap.
2. **The short rows did not move.** In the same capture, the "Move" and "Box"
   groups' descriptions must start at the same x as before — `Style.space(90)`
   is still the floor. Compare against the `?` capture taken during #21.
3. **A second font size.** Open the same sheet in the **bar popup**, which
   renders it at the smaller `fontRow` token. Do **not** run
   `omarchy display text size`: it half-applies against the read-only store
   and then segfaults quickshell (`IpcHandler::onPostReload`, nixarchy #847).
4. `qs log` clean of binding loops and TypeErrors.
5. Clean up: no boxes, no shim, no `shell.toml` (that file does not exist on
   this host's baseline).

## Rollback

One commit for the code. Reverting it restores the overlap and nothing else —
the change is a single layout property on one element. No `Model.js`, no argv,
no lock, no poll, so there is no runtime risk to containers either way.
