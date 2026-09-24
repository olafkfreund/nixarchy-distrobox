---
status: approved
issue: 24
intent: intent/2026-09-24-24-shortcut-key-column.md
---

# Spec: the key column grows to fit its keys

## Design

**Decided at intent approval: widen.** A ragged row is acceptable; a truncated
key is not.

`ShortcutSheet.qml`'s `entryKeys` becomes:

```qml
// A Text paints its full content past `width` unless elide or clip is set,
// and the description anchors to where this says it ends -- so a fixed width
// makes a long key paint over it. Growing instead keeps every key readable;
// eliding would not, and a key you cannot read is worse than a ragged row.
width: Math.max(Style.space(90), implicitWidth)
```

`Style.space(90)` stays as the floor, so every short row keeps today's
alignment and only a row that genuinely needs more takes more. Because the
floor is a token and `implicitWidth` follows the font, this holds at any
`[font] base-size` — the two sides scale together.

Nothing else changes. `entryText` already anchors to `entryKeys.right` and
already elides, so it adapts on its own.

`Model.SHORTCUTS` is deliberately **not** edited. Shortening
`"tab  ↓ / shift+tab  ↑"` would fix today's symptom and leave the next long
entry to reintroduce it, and it would drop the arrow hints that tell the user
`↓`/`↑` also move between fields.

## Alternatives rejected

- **`elide: Text.ElideRight` on the keys.** One word, and it makes the sheet
  useless where it matters: `tab  ↓ / shift+ta…` does not tell anyone what to
  press.
- **A per-group column sized to the group's widest entry.** Keeps each group
  internally aligned, but gives "Create form" a 21-character gutter for its
  three short rows (`space`, `enter`, `esc`), which reads worse than one
  ragged row and needs the width computed across a Repeater's model.
- **Shortening the entry in `SHORTCUTS`.** Smallest diff, treats the symptom,
  loses information. See above.
- **`clip: true` on the keys.** Same readability loss as eliding, with a hard
  edge instead of an ellipsis.

## Risks

- **The ragged row is the accepted cost**, and it is the thing a reviewer will
  notice first. It affects exactly one row today.
- **A key string wider than the sheet itself** would squeeze `entryText` to
  zero width and hide the description. The longest entry is 21 characters
  against a card built from `Style.space(680)`, so this is far off, but it is
  the ceiling: the column grows without bound. If an entry ever approaches
  half the sheet, the per-group option becomes the better answer.
- No command, argv, lock or poll is touched, so there is no runtime risk to
  containers.

## Verification

1. `node tests/run.js` — 103 green; `Model.js` is untouched.
2. `nix flake check` — in particular `no-text-multiplier` from #22, since this
   edits a sizing line.
3. `--all-systems --no-build`, `nix build`, `omarchy plugin validate` on a
   fresh clone.
4. **The actual bug, on hardware:** open `?` in the full-screen menu and read
   the "Create form" group. `tab  ↓ / shift+tab  ↑` and `Next / previous
   field` must not overlap.
5. **The short rows did not move.** Compare the "Move" and "Box" groups before
   and after: their descriptions should start at the same x, because
   `Style.space(90)` is still the floor.
6. **It holds at another text size** — but **not** by running
   `omarchy display text size`, which segfaults the shell on a nixarchy host
   (`IpcHandler::onPostReload`, nixarchy #847). Check the bar popup instead:
   it renders the same sheet at the smaller `fontRow` token, so it exercises a
   different font size for free.
