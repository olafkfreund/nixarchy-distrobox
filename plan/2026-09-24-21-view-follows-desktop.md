---
status: approved
issue: 21
spec: spec/2026-09-24-21-view-follows-desktop.md
---

# Plan: the view follows the desktop

## The approved decisions, carried over

**The problem.** `DistroboxView.qml:22` is `implicitHeight: column.implicitHeight`
and `root.height`/`root.width` are **never read** in that file, so the
screen-derived size `Menu.qml:140-141` hands it is discarded. `BoxList.qml:25`
`maxHeight: Style.space(520)` is declared and **never assigned by either host**;
`LogView.qml:98` (340) and `CreateForm.qml:268` (400) are likewise fixed.
`Style.space()` is a rem unit tracking theme text size, never the screen. On top
of that, `Menu.qml:30,142` applies 1.45 as a raster `scale:` transform, so
wrapping and eliding are computed pre-transform and then stretched.

**The approved principle.** Readability scale and available space are *different
quantities*; one constant is currently doing both jobs. So **`textScale` stays a
constant 1.45** (a menu read from across the room wants bigger text whatever the
monitor is, and this converges on `nixarchy-pkg`'s convention), and **the size
caps become screen-derived**.

**The approved mechanism.** Adopt `nixarchy-pkg`'s convention, verified at
`/nix/store/2fn1qcqvxv7z95n568w41nbn87m55jzz-nixarchy-pkg/Menu.qml:35-36`,
`Card.qml:19,37`, `OptionForm.qml:47-48`, and
`/nix/store/3bd1wdza1v1m8l6zgjc733frcm6csx06-nixarchy-flatsnap-plugin/Menu.qml:22-23`
(`grep -c 'scale:'` is 0 for every `.qml` in both):

```qml
property real textScale: 1.0
function px(base) { return Math.round(base * root.textScale) }
```

`Menu.qml` passes `1.45`; `Panel.qml` passes nothing, so the popup is unchanged
**by construction** (`round(n * 1.0) === n`), which is a hard requirement.

**Approved scope limits.** Plumb-through, *not* a `ColumnLayout` rewrite.
`Menu.qml:31` `viewWidth` and `Panel.qml:110`'s 470 stay as they are.
`Model.js` is not touched. **Do not edit `nixarchy-microvm` or
`nixarchy-podman`** — separate repos with their own gates (their #24 and #22),
and podman does not even share this defect (its height plumbing is live, merely
clamped).

**The named top risk: binding loops.** `availableContent` must flow strictly
downward from `root.height`. It must **never** read `column.implicitHeight`, or
Qt oscillates. Chrome height is summed from the *fixed-height siblings* only —
they do not depend on `availableContent`, so reading them is safe.

## Steps

1. **`DistroboxView.qml`: add `textScale` and `px()`.** `property real
   textScale: 1.0`; `function px(base) { return Math.round(base * root.textScale) }`.
   Add the same pair to `BoxList.qml`, `CreateForm.qml`, `LogView.qml` and
   `ShortcutSheet.qml`, each taking `textScale` as a property, and pass
   `textScale: root.textScale` down at every instantiation site.
   → verify by `grep -c 'function px'` = 5.

2. **Wrap the size tokens.** Mechanically replace `Style.space(n)` →
   `px(Style.space(n))`, `Style.font.x` → `px(Style.font.x)`, `Style.spacing.x`
   → `px(Style.spacing.x)` across the five files. Approximate surface:
   `DistroboxView` 20, `BoxList` 17, `CreateForm` 22, `LogView` 12,
   `ShortcutSheet` 17 call sites. No literal pixel values introduced — the
   no-raw-pixels and `Color.*`/`Style.*` token rules still hold.
   → verify by `nix flake check` (hex-colour check) and by `grep -nE
   'Style\.(space|font|spacing)' | grep -v 'px('` returning nothing.

3. **`Menu.qml`: drop the transform.** Remove `scale:` and `transformOrigin:`
   (`:142-143`); set the view to `width: frame.width; height: frame.height`
   (`:140-141`, no division); rename `uiScale` → `textScale` (`:30`) and pass it
   to the view. Update `Menu.qml:112,114` which multiply by `uiScale`.
   → verify by `grep -c 'scale:' Menu.qml` = 0.

4. **`Menu.qml`: fix the comment** at `:27-29`. It currently claims "the same
   factor nixarchy-pkg's menu uses" — true of the number, false of the
   mechanism, which is how the divergence survived. State that the factor is
   applied as a layout multiplier as `nixarchy-pkg` does.
   → verify by reading it.

5. **`DistroboxView.qml`: derive `availableContent`.** Sum the fixed-height
   siblings (`filterField`, the error row, the counts row) plus
   `column.spacing` per visible gap into a `chromeHeight` readonly property —
   **reading only those siblings, never `column.implicitHeight`**. Then:

   ```qml
   readonly property int availableContent: root.availableHeight > 0
     ? Math.max(px(Style.space(120)), root.availableHeight - fixedChrome)
     : px(Style.space(520))   // unbounded host: today's cap
   ```
   → verify by step 8 (no binding-loop warnings).

   **Deviation: the budget comes from the panel, not from `root.height`.**
   The plan said to derive this from the height the host assigns. Writing it
   that way closed exactly the loop this plan warned about, one level up in
   `Menu.qml`: the card is sized from `view.implicitHeight`
   (`Menu.qml:123-125`), so `card.height -> view.implicitHeight ->
   availableContent -> root.height -> frame.height -> card.height`. The view's
   own binding was non-circular; the cycle ran through the host.

   Resolved with a new `availableHeight` property that the host sets from the
   SCREEN — `Math.round(panel.height * 0.8)` minus the card insets, matching
   the card's own clamp. It depends only on the monitor, which nothing
   downstream can feed, so the cycle cannot close. `0` means unbounded, which
   is what the bar popup passes (it sizes itself from `implicitHeight`).

   `fixedChrome` is likewise computed by iterating `column.children` and
   skipping the four variable children, rather than summing named siblings:
   non-circular for the same reason, and a fixed row added later is counted
   without anyone having to remember to update it.

6. **Bind the three caps.** `BoxList.maxHeight`, `LogView`'s list height
   (`:98`) and `CreateForm`'s Flickable cap (`:268`) all bind to
   `availableContent`. `BoxList.qml:25`'s default stays as the fallback for a
   host that assigns nothing.
   → verify by grep that no fixed 520/340/400 remains unbound.

7. **Keep `implicitHeight` working.** `Menu.qml:114` still sizes the card from
   `view.implicitHeight`, which must stay valid before the host assigns a
   height — that is what the `availableContent` fallback is for.
   → verify by opening the menu from a cold shell start.

8. **Runtime verification** — see Tests.

One commit per step, each citing the step number and `(#21)`. Step 2 is large
but mechanical; keep it a single commit so the diff reads as one transformation.

## Tests

```bash
node tests/run.js        # expect 99 passed, 0 failed — Model.js is untouched
nix flake check
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

Runtime, on a nixarchy desktop, installing a real copy per AGENTS.md:

1. **No binding-loop warnings** in `qs log -i <instance>` after opening both
   surfaces in every mode (list, form, log, snippet, `?`). A clean log is a
   **required outcome**, not a nicety — this is the named top risk.
2. **The bar popup is pixel-identical.** Capture before and after at the same
   theme text size and diff the images.
3. **The menu follows the screen.** Open on two monitors of different sizes;
   the card and the list must grow with the larger. On the short screen the list
   must **scroll** rather than be clipped unreachably — the specific failure from
   the intent.
4. **Reflow works.** A box name long enough to elide must elide at the width it
   is actually drawn at, not at the pre-transform width. This is the defect the
   change is justified by.
5. **Theme text size still tracks.** Change `omarchy display text size`; both
   surfaces follow, menu remaining 1.45× the popup.
6. **The blurriness question, settled.** Menu and bar popup side by side showing
   the same box name at the same theme text size — the popup is the
   untransformed control, so any difference is the transform and not the font
   stack. **Record the result here**, and report it to the `nixarchy-microvm`
   (#24) and `nixarchy-podman` (#22) sessions: both issues currently assert
   softness as established, and neither has measured it.
7. `docs/usage.md` and `README.md` updated in the same PR if anything
   user-visible changed.

Clean up any `t*` boxes with `distrobox rm`.

## Rollback

One commit per step on `fix/21-view-follows-desktop`. Step 2 is the large one;
reverting it alone restores the old sizes while leaving `px()` defined and
harmless. Reverting steps 3-6 restores the transform. Because `textScale`
defaults to `1.0`, a partial revert can never change the bar popup. Nothing
outside the five drawing files, `Menu.qml` and `Panel.qml` is touched, and no
command path or argv is involved, so there is no runtime risk to containers.
