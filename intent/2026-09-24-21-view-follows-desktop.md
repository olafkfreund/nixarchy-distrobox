---
status: approved
issue: 21
author: olafkfreund
---

# Intent: the view should follow the desktop, not a constant

## Problem

The complaint is that the text and the windows do not follow the desktop size
and scale. There are two defects behind it, and the conspicuous one is not the
cause.

### The cause: the host measures the screen, the view discards it

Both hosts size themselves correctly against the real monitor. `Menu.qml:112-115`
clamps the card to `panel.width * 0.9` and `panel.height * 0.8`, `frame` fills
that, and `Menu.qml:140-141` hands the view `frame.width / uiScale` and
`frame.height / uiScale`.

`DistroboxView.qml:22` is `implicitHeight: column.implicitHeight`, and
`root.height` and `root.width` are **never read anywhere in that file**. The
measured size is thrown away and the view sizes itself to its own content.

Every cap inside is then a constant no host ever sets:

| File | Cap | Set by a host? |
| --- | --- | --- |
| `BoxList.qml:25` | `maxHeight: Style.space(520)` | no — declared, never assigned |
| `LogView.qml:98` | `height: Style.space(340)` | no |
| `CreateForm.qml:268` | cap `Style.space(400)` | no |
| `Menu.qml:31` | `viewWidth: Style.space(680)` | fixed |
| `Panel.qml:110` | `Style.space(470)` | fixed |

`Style.space()` is a rem unit. It tracks the theme text size, never the screen.
So the surface is screen-blind in both directions: it will not grow into a large
monitor, and on a short panel the card clamps to 80% while the view keeps its
larger `implicitHeight`. `frame` has `clip: true` and there is no outer scroll,
so the overflow is cut off and unreachable. The inner lists scroll only within
their own fixed caps, which is why this is easy to miss.

### The symptom: a raster scale transform

`Menu.qml:30,142` applies `uiScale: 1.45` as `scale:` with
`transformOrigin: Item.TopLeft` across the whole view.

The certain defect is that **nothing reflows**. Wrapping and eliding are computed
at the pre-transform size and then stretched, so text that would wrap at the real
width does not.

A second claim was made in review — that magnifying glyphs hinted for 12px to
17.4px is what makes menu text look soft. **That is unverified.** Qt Quick's
distance-field text rendering may scale cleanly under a transform. It should be
settled on real hardware before anyone relies on it; the reflow bug justifies the
change without it.

### The fix already exists in this plugin family

`nixarchy-pkg` and `nixarchy-flatsnap` use the same 1.45 factor, name it
`textScale`, and apply it as a layout-time multiplier:

```qml
readonly property real textScale: 1.45
function px(base) { return Math.round(base * root.textScale) }
```

`grep -c 'scale:'` returns 0 for every `.qml` in both plugins — they do not use a
scale transform at all. Verified at
`/nix/store/2fn1qcqvxv7z95n568w41nbn87m55jzz-nixarchy-pkg/Menu.qml:35-36` and
`/nix/store/3bd1wdza1v1m8l6zgjc733frcm6csx06-nixarchy-flatsnap-plugin/Menu.qml:22-23`.

`nixarchy-distrobox`, `nixarchy-microvm` and `nixarchy-podman` all carry the
`uiScale` transform instead, with the same constant and the same comment, which
suggests it was copied between the three rather than chosen.

## Proposed outcome

- The menu grows into a large monitor and fits a short one, because the view
  honours the size its host already computes instead of discarding it.
- Nothing is clipped unreachably: content that exceeds the card is scrollable.
- Text reflows at its real width — wrapping and eliding are computed at the size
  the user actually sees.
- The menu stays visibly larger than the bar popup. This is about *how* the
  factor is applied, not about removing it; simply deleting the transform would
  lose the larger-from-further-away readability the whole family shares.
- The comment at `Menu.qml:27-29` describes what the code now does.

## Affected users and systems

Anyone opening the full-screen menu, most visibly on a monitor far from
1920x1080 or with a non-default theme text size. Touches `Menu.qml`,
`DistroboxView.qml` and the four drawing files that carry the fixed caps.
`Panel.qml` shares the constant-width shape and should be considered in the same
pass. No change to `Model.js` or to any command path.

`nixarchy-microvm` and `nixarchy-podman` carry the same `uiScale` transform, but
their sizing is **not** in the same state and a distrobox-shaped patch does not
transfer:

- `nixarchy-microvm` does have the discarded-height shape — `MicrovmView.qml:22`
  is `implicitHeight: column.implicitHeight` with `root.height` never read, and
  `VmList.maxHeight` is declared and never assigned.
- `nixarchy-podman` does **not**. Its height plumbing is live: `Menu.qml:162`
  derives `listMaxHeight` from `panel.height * 0.85`, `PodmanView.qml:373` passes
  it down, and `ResourceList.qml:89` consumes it. Its defect is narrower — the
  screen-derived value is wrapped in `Math.min(Style.space(560), …)`, so a
  constant wins past a certain screen height. Read then clamped, not ignored.

So for podman the transform is an independent defect (the reflow argument) and
the cap is a second one: two fixes, not one root cause. Carrying that distinction
matters, or someone lands a distrobox-shaped patch there and wonders why the
reflow remains.

Both are separate repositories with their own artifact gates — podman is already
tracked by its own maintainer as that repo's issue #22. **This work must not edit
either repository**; a follow-up issue against each is the correct handoff.

## Constraints

- No hardcoded colours, and no raw pixel literals: sizes keep going through
  `Style.space()` / `Style.font.*` tokens, now multiplied rather than transformed.
- The bar popup must not change size. It is read from close up and 1.45 is
  deliberately a menu-only factor.
- A new runtime file, if any, goes in the `files` list in `flake.nix`.
- Both surfaces are keep-loaded: any new sizing must survive close and reopen
  without leaking state between opens.
- Prefer matching the existing `px()` convention over inventing a second
  mechanism, so the family converges rather than diverging further.

## Open questions

1. **Does the 1.45 stay a constant, or become screen-derived?** Matching
   `nixarchy-pkg`'s `px()` fixes reflow and clipping but leaves a constant that
   still ignores the monitor. Deriving it from the screen fixes more but diverges
   from the family. The owner's call.
2. **How far does "honour the host size" go?** Minimally, `DistroboxView` reads
   `root.height` and the hosts set `BoxList.maxHeight`. Maximally, every cap in
   the table becomes a fraction of the card. The first is a much smaller diff.
3. **Is the blurriness real?** Worth one check on real hardware, because if it is
   not, the case rests entirely on reflow and clipping — still sufficient, but it
   changes how the fix is described.
4. **Should `Panel.qml:110`'s fixed 470 width be in scope**, or left alone since
   the bar popup is not the thing that looks wrong?
