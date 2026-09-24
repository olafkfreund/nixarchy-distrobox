---
status: approved
issue: 30
spec: spec/2026-09-24-30-sheet-sizes-itself.md
---

# Plan: the shortcut sheet sizes itself

## The approved decisions, carried over

**The problem.** `ShortcutSheet` is mounted `anchors.fill: parent`, so it
never contributes to `column.implicitHeight` and never reaches
`view.implicitHeight` — which is exactly what both hosts size from
(`Menu.qml`'s card, `Panel.qml`'s `fittedContentHeight`). The sheet is
therefore clipped to a card decided by the list behind it, and is smallest
with 0 boxes, which is when a new user most needs it.

**The approved design:** the sheet reports what it needs, the view folds it in
while open, and **neither host changes**.

```qml
// ShortcutSheet.qml
readonly property int naturalHeight: sheetColumn.implicitHeight

// DistroboxView.qml
implicitHeight: root.helpOpen
  ? Math.max(column.implicitHeight, helpSheet.naturalHeight)
  : column.implicitHeight
```

**Grows, never shrinks** (`Math.max`), matching `Menu.qml`'s existing "the
card grows and shrinks downwards only, so it does not jump" intent.

**The popup gets it too**, and the growth is bounded by the shell:
`PopupCard.fittedContentHeight` clamps to `availableCardHeight`
(`Ui/PopupCard.qml:47-52`); the menu is clamped by `panel.height * 0.8`.
Neither can run away and no cap of our own is needed.

**Why it cannot loop** — the whole risk, measured: `sheetColumn.width` is
`flick.width`, **width only**, and `flick.height` appears in `ShortcutSheet`
at just `:37` (scroll clamping) and `:62` (`y`, centring), never in a height.
So `naturalHeight` depends on the entry count, the font roles and the width,
and the width flows from the `viewWidth` constant. This is the shape #21 had
to design around, so it is verified rather than assumed.

## Steps

1. **`ShortcutSheet.qml`: expose `naturalHeight`.** A `readonly property int`
   returning `sheetColumn.implicitHeight`, with a comment saying it is derived
   from content and width only — never from the height it is given — so it is
   safe to read upward.
   → verify by grep, and by confirming no `flick.height` appears in any height
   expression in the file.

2. **`DistroboxView.qml`: fold it into `implicitHeight`** while `helpOpen`,
   with `Math.max` so it can only grow.
   → verify by reading; and at runtime by step 3's clean log, which is what
   would catch a loop.

3. **Runtime verification** on razer — see Tests.

Three commits, each citing the step and `(#30)`. No `Model.js` change, so no
new tests: the defect is a layout binding, not logic.

## Tests

```bash
node tests/run.js                 # 103, unchanged
nix flake check                   # incl. #22's no-text-multiplier
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

Runtime, on razer, installed as a real copy per AGENTS.md. **Ask the sibling
sessions first** — that desktop is shared, and a foreign `nixarchy-*-menu`
layer in a capture means someone else is on it. Run each sequence in **one**
ssh invocation; the menu layer has closed between separate ones.

1. **No binding-loop warnings** in `qs log` after opening and closing `?` on
   both surfaces, in every mode. **Required, not incidental** — a loop is the
   failure mode this design is built to avoid, and Qt reports it in the log
   rather than on screen.
2. **The reported bug, 0 boxes:** open the menu with no boxes, press `?`, and
   confirm the sheet is readable rather than two rows tall.
3. **The popup, 0 boxes:** same, plus a judgement call that the result is not
   absurdly large for a surface anchored under the glyph. If it is, the spec's
   decision 3 is wrong and the plan needs revising rather than forcing.
4. **Many boxes:** with 5+, opening `?` must not shrink or jump the surface.
5. **Closing `?` restores the list's own height** on both surfaces, and
   survives close and reopen — both are keep-loaded.
6. **Do not** run `omarchy display text size`; it segfaults the shell here
   (`IpcHandler::onPostReload`, nixarchy #847). The popup gives a second font
   size for free.
7. Clean up: no boxes, no shims, no `shell.toml` (absent on this host's
   baseline).

## Runtime verification: results (razer, 2026-09-24)

| Test | Result |
| --- | --- |
| 1. No binding-loop warnings | **pass — 0**, on both surfaces in every mode. The required outcome, and the one a screenshot could not have shown |
| 2. Menu, 0 boxes | **pass** — every group (MOVE → LOG) visible, where it was two rows before |
| 3. Popup, 0 boxes | **pass** — the full sheet including the footer hint, still anchored under the glyph and still reading as a popup rather than a takeover |
| 4. Many boxes | **pass** — with 5 boxes `?` grew the card and did not shrink or clip it |
| 5. Closing `?` restores | **pass** — back to the list's own height with all 5 rows |
| 6. Text size | not run, by design — the command segfaults the shell here |

### Decision 3 stands

The plan allowed step 3 to send the spec back if the grown popup looked
absurd. It does not: it fills roughly two thirds of the screen height at the
smaller `caption` token, stays under the glyph, and is bounded by
`availableCardHeight` as predicted. No revision needed.

### Observed, and accepted

With 5 boxes the card grows on `?` and returns on `esc` — visible motion that
did not exist before. `Math.max` only governs the sheet-open state never being
*smaller* than the list; returning to the list's height on close is correct.
Flagged as a risk in the spec, and it looks fine in practice.

## Rollback

One commit per step. Reverting step 2 alone restores today's behaviour exactly
while leaving `naturalHeight` defined and unused; reverting both removes it.
Nothing outside those two files is touched — no host, no `Model.js`, no argv,
no lock, no poll — so there is no runtime risk to containers either way.
