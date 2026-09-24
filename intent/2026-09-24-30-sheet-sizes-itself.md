---
status: approved
issue: 30
author: olafkfreund
---

# Intent: the shortcut sheet should size itself

## Problem

With no boxes, pressing `?` shows a sheet a few rows tall: the first group
and part of the next. Captured on razer with 0 boxes, it showed `MOVE` and
stopped at the `BOX` header. It scrolls, so nothing is unreachable — but a
reference list you scroll four times to read is not much of a reference, and
the one moment you most need the key list is when there are no boxes yet and
you do not know how to make one.

The sheet is an overlay:

```qml
ShortcutSheet { id: helpSheet; anchors.fill: parent; ... }
```

`anchors.fill` means it never contributes to `column.implicitHeight`, so it
never reaches `view.implicitHeight`. Both hosts size themselves from exactly
that — `Menu.qml`'s card from `view.implicitHeight + insets`, and
`Panel.qml`'s popup from `fittedContentHeight(view.implicitHeight)`. So the
sheet is clipped to a card whose height was decided entirely by the *list
behind it*. Five boxes gives a card tall enough to read most of the sheet;
zero boxes gives a few rows.

Not a regression from #21. That change made the card grow to the screen clamp
when content is tall, which is why the sheet is readable with a handful of
boxes. It simply never taught either host that the sheet is content too.

## Proposed outcome

- Opening `?` shows the sheet at a useful height regardless of how many boxes
  exist — in particular with none.
- The list's own sizing is unchanged when the sheet is closed.
- Both surfaces behave: the menu and the bar popup.
- The screen still wins. The sheet may not push a surface past the clamp that
  #21 established; it should scroll instead, as it does now.

## Affected users and systems

Anyone pressing `?`, most visibly on a fresh install with no boxes. Touches
`ShortcutSheet.qml` and `DistroboxView.qml`, and possibly the two hosts. No
command, argv, lock or poll is involved.

## Constraints

- **The binding must flow one way.** #21 had to design around exactly this
  shape: `card.height → view.implicitHeight → availableContent → root.height
  → frame.height → card.height`. Anything that feeds a container's height
  back into the thing the container sizes will loop, and Qt will oscillate.
- A check that the fix is safe rather than lucky: the sheet's natural height
  must not depend on the height it is given. Measured — `sheetColumn.width` is
  `flick.width` (width only), and `flick.height` appears only in `y` for
  centring and in scroll clamping, never in `implicitHeight`. So its natural
  height comes from the entry count, the fonts and the width, and the width
  comes from a constant (`viewWidth`). There is no height cycle to close.
- Sizes keep going through `Style.*` tokens and the `font*` roles from #22;
  `nix flake check`'s `no-text-multiplier` rejects a literal `pixelSize`.
- Both surfaces are keep-loaded, so whatever changes must survive close and
  reopen, and `?` must not leave the surface stuck at sheet height once the
  sheet closes.

## Open questions

1. **Where does the height come from?** The sheet could expose its natural
   height and the view take `Math.max(column.implicitHeight, sheet)` while
   open; or each host could size the surface differently when the view says
   the sheet is open. The first keeps the hosts ignorant of the sheet, which
   seems right, but it makes `implicitHeight` mode-dependent.
2. **Should the sheet ever shrink the surface?** With many boxes the card is
   already taller than the sheet needs. `Math.max` leaves that alone, which is
   probably right — but it means opening `?` can grow a surface and never
   shrink it.
3. **Does the bar popup want this at all?** It is anchored under the glyph and
   is deliberately compact; growing it to full sheet height may be wrong
   there even if it is right for the menu.
