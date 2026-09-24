---
status: approved
issue: 24
author: olafkfreund
---

# Intent: a long shortcut should not paint over its description

## Problem

In the shortcut sheet (`?`), the "Create form" row renders as

```
tab  ↓ / shift+taNext / previous field
```

The key column is a fixed width with no `elide` and no `clip`
(`ShortcutSheet.qml`), and a QML `Text` paints its full content regardless of
`width` unless one of those is set. The width only positions the sibling
anchored to its right. So any `keys` string wider than the column overruns the
description, which starts where the column *says* it ends.

Exactly one entry is long enough today: `"tab  ↓ / shift+tab  ↑"` at 21
characters, against a next-longest of 9. That is why it has gone unnoticed.

Pre-existing, not a regression: confirmed on `main` before #21 and #22 touched
that file (`git show main:ShortcutSheet.qml`), which only rewrapped and then
retokenised the same line.

## Proposed outcome

- No shortcut's keys overlap its description, at any text size.
- The keys stay fully readable. Truncating a key would make the sheet worse
  than the overlap does.
- A future long entry does not bring the problem back — the fix should handle
  the class, not this one string.

## Affected users and systems

Anyone pressing `?`, on both surfaces. Touches `ShortcutSheet.qml`, and
possibly `Model.js`'s `SHORTCUTS` if the answer turns out to be shorter text.
No command, argv or lock is involved.

## Constraints

- Sizes keep going through `Style.*` tokens, and font sizes through the
  `font*` roles from #22 — `nix flake check`'s `no-text-multiplier` rejects a
  literal `pixelSize`.
- Both the column width and the font scale with the desktop text size, so the
  fix has to hold at any `[font] base-size`, not just the default.
- `ShortcutSheet` renders `Model.shortcutGroups()` and must stay that way, so
  the sheet cannot drift from the keys the view actually handles.

## Open questions

1. **Widen, wrap, or shorten?** Making the column `Math.max(fixed,
   implicitWidth)` fixes the class in one line, at the cost of that one row's
   description starting further right than its neighbours'. Sizing every
   group's column to its widest entry keeps each group aligned but gives the
   "Create form" group a wide gutter for its three short rows. Shortening the
   string in `SHORTCUTS` is the smallest change but treats the symptom and
   loses the arrow hints.
2. **Is a ragged row acceptable?** It is the visible trade-off of the
   one-line fix, and it is a judgement about how the sheet should look.
