---
status: draft
issue: 21
intent: intent/2026-09-24-21-view-follows-desktop.md
---

# Spec: the view follows the desktop, not a constant

## Design

Two separate things are wrong and they need separating, because conflating them
is what produced the current code. **Readability scale and available space are
different quantities.** The 1.45× answers "how big should text be when read from
across the room"; the screen answers "how much room is there". Today one constant
is doing both jobs and doing neither well.

So:

- **`textScale` stays a constant 1.45.** It is a readability factor, not a size
  budget. A menu read from two metres away wants larger text whether the monitor
  is 1080p or 4K, so deriving it from screen dimensions would be answering the
  wrong question. This also converges the family on `nixarchy-pkg`'s convention
  rather than inventing a third mechanism.
- **Every size cap becomes screen-derived**, because that is the quantity that
  actually varies with the desktop.

This answers the intent's open question 1: constant scale, derived sizes.

### 1. Apply the factor at layout time, not as a transform

Adopt the convention already shipping in `nixarchy-pkg` (`Menu.qml:35-36`,
`Card.qml:19,37`, `OptionForm.qml:47-48`) and `nixarchy-flatsnap`
(`Menu.qml:22-23`):

```qml
property real textScale: 1.0                                   // 1.45 from Menu, 1.0 from Panel
function px(base) { return Math.round(base * root.textScale) }
```

`DistroboxView` takes `textScale` as a property defaulting to `1.0`, so the bar
popup is unchanged by construction — satisfying the intent's constraint that the
popup must not move. `Menu.qml` passes `1.45`; `Panel.qml` passes nothing.

Every `Style.space(n)` and `font.pixelSize: Style.font.x` inside the view and its
four drawing files becomes `px(Style.space(n))` and
`px(Style.font.x)`. Sizes stay tokenised — they are multiplied, not replaced by
literals — so the no-raw-pixels rule holds.

`Menu.qml:142-143` loses `scale:` and `transformOrigin:`, and `:140-141` stop
dividing by `uiScale`: the view is laid out at `frame.width × frame.height`
directly. `uiScale` is renamed `textScale` to match the family and to stop the
name implying a transform.

This is what fixes reflow: wrapping and eliding are computed at the real rendered
size instead of at a smaller size and then stretched.

### 2. Stop discarding the height the host computes

`DistroboxView.qml:22` is `implicitHeight: column.implicitHeight` and `root.height`
is never read. The fix is a plumb-through, **not** a conversion to `Layout`
anchoring — the latter is a much larger diff across five files for no additional
behaviour.

`DistroboxView` computes the space left for the one variable-height child after
the fixed chrome above and below it, and passes that down:

```qml
// The room the host actually gave us, minus everything of fixed height.
readonly property int availableContent: root.height > 0
  ? Math.max(px(Style.space(120)), root.height - chromeHeight)
  : px(Style.space(520))        // unbounded host: fall back to today's cap
```

- `BoxList.maxHeight` — currently declared at `BoxList.qml:25` and **never
  assigned by either host** — is bound to it.
- `LogView`'s list height (`:98`, fixed 340) is bound to it.
- `CreateForm`'s Flickable cap (`:268`, fixed 400) is bound to it.

The floor keeps a pathologically short screen from collapsing the list to
nothing, and the fallback keeps the component usable when a host gives it no
height. `Menu.qml:31`'s `viewWidth` and `Panel.qml:110`'s `470` stay as they are
for now — see the answer to open question 4 below.

This answers open question 2 at the **minimal** end: one derived property and
three bindings, rather than every cap in the table becoming its own fraction.

### 3. Fix the comment

`Menu.qml:27-29` claims this is "the same factor nixarchy-pkg's menu uses". True
of the number, false of the mechanism — which is how the divergence survived. It
is rewritten to say the factor is applied as a layout multiplier the way
`nixarchy-pkg` does, so the next reader cannot repeat the mistake.

### 4. The blurriness claim

Open question 3. The case for this change rests on **reflow and clipping**, both
of which are verified. The claim that magnifying 12px-hinted glyphs to 17.4px
softens text is *not* verified — Qt Quick's distance-field rendering may scale
cleanly, as the `nixarchy-podman` session pointed out. Verification below
includes a check, but the change does not depend on the answer and no document
should assert it until measured.

## Alternatives rejected

- **Delete the transform outright.** Smallest possible diff, but the menu would
  render at bar-popup size and lose the larger-from-further-away readability the
  whole plugin family shares. Rejected: it fixes the mechanism by removing the
  feature.
- **Derive `textScale` from screen dimensions.** Conflates readability with
  available space — the same error as today, differently parameterised. A 4K
  monitor at arm's length does not want 1.45×; a 1080p TV across the room does.
  Rejected in favour of constant scale + derived sizes.
- **`Screen.devicePixelRatio` for layout.** Wrong on Wayland: layer-shell
  surfaces receive logical pixels with compositor scale already applied, so this
  would double-apply it.
- **Convert the view to `ColumnLayout` with `Layout.fillHeight`.** The idiomatic
  QML answer and genuinely cleaner, but it rewrites the layout of five drawing
  files to fix a sizing bug. Rejected as disproportionate; revisit if the
  plumb-through proves fragile.
- **Fix microvm and podman in the same pass.** Separate repositories with their
  own owner-approved artifact gates. microvm tracks this as its #24, podman as
  its #22. Podman additionally does *not* share the discarded-height defect — its
  plumbing is live and merely clamped — so a patch from here would not transfer.

## Risks

- **Wide blast radius inside the plugin.** Every size expression in
  `DistroboxView`, `BoxList`, `CreateForm`, `LogView` and `ShortcutSheet` is
  touched. The mitigation is that it is a mechanical wrap — `px(...)` around an
  existing token — with no logic change, and the bar popup passes `1.0` so its
  arithmetic is provably identity.
- **The bar popup must not move.** `textScale` defaults to `1.0` and
  `Math.round(n * 1.0) === n`, so this is guaranteed by construction rather than
  by inspection. Verified by screenshot comparison anyway.
- **`chromeHeight` is a new quantity that can drift.** If a fixed-height element
  is added to the column later and not counted, the content is over-allocated and
  clips again. Mitigated by deriving it from the actual sibling items'
  `implicitHeight` rather than from a constant.
- **Binding loops.** `availableContent` derives from `root.height` while children
  report `implicitHeight` upward. The binding must flow strictly downward from
  `root.height` and never read `column.implicitHeight`, or Qt will warn and the
  layout will oscillate. This is the single most likely implementation failure.
- **`implicitHeight` is still needed** by `Menu.qml:114`, which sizes the card
  from it. It must keep working when the host has not yet assigned a height —
  hence the fallback.
- Host: nixarchy desktops. No change to `Model.js`, to any argv, or to the
  host-quoting surface.

## Verification

1. `node tests/run.js` — 99 still green (no `Model.js` change expected).
2. `nix flake check`, `--all-systems --no-build`, `nix build`,
   `omarchy plugin validate` on a fresh clone. The hex-colour and no-symlink
   checks still pass.
3. **No binding-loop warnings** in `qs log -i <instance>` after opening both
   surfaces in every mode. A clean log is a required outcome, not a nicety.
4. **The bar popup is pixel-identical.** Capture before and after at the same
   theme text size and diff.
5. **The menu follows the screen.** Open on two monitors of different sizes and
   confirm the card and the list grow with the larger one. On a short screen,
   confirm the list scrolls rather than being clipped unreachably — the specific
   failure from the intent.
6. **Reflow works.** A box name long enough to elide must elide at the width it
   is actually drawn at, not at the pre-transform width.
7. **Text size still follows the theme.** Change `omarchy display text size` and
   confirm both surfaces track it, with the menu remaining 1.45× the popup.
8. **The blurriness question, settled.** Menu and bar popup side by side showing
   the same box name at the same theme text size; the popup is the untransformed
   control. Record the result in the plan and report it to the microvm and podman
   sessions, whose issues both currently assert softness as established.
9. `docs/usage.md` and `README.md` updated in the same PR if anything
   user-visible changes.
