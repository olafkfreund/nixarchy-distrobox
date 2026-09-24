---
status: approved
issue: 30
intent: intent/2026-09-24-30-sheet-sizes-itself.md
---

# Spec: the shortcut sheet sizes itself

## Design

The intent's three open questions were delegated. Answers, with reasons:

### 1. The sheet reports its height; the hosts stay ignorant

`ShortcutSheet` exposes what it would like to be:

```qml
// What the sheet needs to show every group without scrolling. Derived from
// the entry count, the fonts and the width -- never from the height it is
// given, so this can be read upward without closing a loop.
readonly property int naturalHeight: sheetColumn.implicitHeight
```

and `DistroboxView` folds it in only while the sheet is up:

```qml
implicitHeight: root.helpOpen
  ? Math.max(column.implicitHeight, helpSheet.naturalHeight)
  : column.implicitHeight
```

Both hosts already size from `view.implicitHeight`, so **neither host
changes**. That is the point: `Menu.qml` and `Panel.qml` should not have to
know the sheet exists, and a future surface gets the behaviour for free.

The cost is that `implicitHeight` becomes mode-dependent. That is acceptable
— it already varies with the mode, because `column`'s children are
`visible`-switched per mode and an invisible child contributes nothing.

### 2. It grows, never shrinks

`Math.max`, so opening `?` with many boxes leaves the surface exactly as it
is. Shrinking would make the card jump on a keypress, and `Menu.qml` already
records the opposite intent for the same reason: *"the card grows and shrinks
downwards only, so it does not jump while the filter changes the list's
height."* Consistency with that beats a tighter fit.

### 3. The bar popup gets it too

The bug is identical there — 0 boxes gives a popup too short for the sheet —
and "press `?` to learn the keys" is the same need on both surfaces.

The growth is already bounded, which is what makes this safe rather than
merely consistent: `PopupCard.fittedContentHeight` clamps to
`availableCardHeight` (`Ui/PopupCard.qml:47-52`), so the popup grows only
into room the shell says it has, and the sheet scrolls beyond that. The menu
is clamped the same way by its own `panel.height * 0.8`. Neither surface can
run away, and no cap of our own is needed.

### Why this cannot loop

The constraint the intent set, restated because it is the whole risk:
`sheetColumn.width` is `flick.width` — **width only** — and `flick.height`
appears in `ShortcutSheet` only at `:37` (scroll clamping) and `:62` (`y`, to
centre a short sheet), never in any height. So `naturalHeight` depends on the
entry count, the font roles and the width; the width flows from the card's
`viewWidth` constant. Nothing downstream of `implicitHeight` feeds back into
it.

This is the shape #21 had to design around (`card.height →
view.implicitHeight → availableContent → root.height → frame.height →
card.height`), so it is verified rather than assumed.

### Centring still works

`sheetColumn.y` centres the column when `flick.height > implicitHeight`. Once
the surface grows to `naturalHeight` the two are equal and `y` is 0, which is
correct. With many boxes the card stays taller and the sheet stays centred, as
now.

## Alternatives rejected

- **Each host sizes the surface when the view says the sheet is open.**
  Spreads knowledge of the sheet into two hosts, and a third surface would
  have to remember. Rejected for the same reason the roles in #22 live on the
  view.
- **Give the sheet a fixed minimum height.** A constant that is wrong at some
  font size, and `no-text-multiplier` exists precisely to stop that habit.
- **Let the sheet push past the screen clamp.** Rejected: #21 established that
  the screen wins, and the sheet already scrolls.
- **Make `ShortcutSheet` a column child rather than an overlay.** Would size
  naturally, but the sheet must cover the list opaquely and sit above it;
  restructuring the mode switching for this is disproportionate.

## Risks

- **`implicitHeight` now changes when `helpOpen` flips**, so both surfaces
  resize on `?`. That is the intended behaviour, but it is a visible motion
  that did not exist before, and worth watching for jank on open.
- **A binding loop is the failure mode if the analysis above is wrong.** Qt
  reports it, so verification must read the log, not just look at the screen.
- **The popup could feel large** on a small screen even when clamped. The
  clamp is the shell's own `availableCardHeight`, so it cannot exceed what the
  shell allows, but the subjective judgement belongs in the runtime check.
- No `Model.js`, argv, lock or poll is touched, so no runtime risk to
  containers.

## Verification

1. `node tests/run.js` — 103 green; `Model.js` untouched.
2. `nix flake check` (incl. `no-text-multiplier`), `--all-systems --no-build`,
   `nix build`, `omarchy plugin validate` on a fresh clone.
3. **No binding-loop warnings** in `qs log` after opening and closing `?` on
   both surfaces, in every mode. A clean log is required, not incidental.
4. **The reported bug, with 0 boxes:** open the menu, press `?`, and confirm
   the sheet is readable rather than two rows tall.
5. **The popup, with 0 boxes:** same check, and a judgement that the result
   is not absurdly large for a surface anchored under the glyph.
6. **Many boxes:** with 5+, opening `?` must not shrink or jump the surface.
7. **Closing `?` restores the list's own height** on both surfaces, and
   survives close/reopen — both are keep-loaded.
8. Do **not** run `omarchy display text size`: it segfaults the shell on a
   nixarchy host (`IpcHandler::onPostReload`, nixarchy #847). The popup gives
   a second font size for free.
