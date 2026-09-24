---
status: approved
issue: 22
spec: spec/2026-09-24-22-text-follows-desktop-scale.md
---

# Plan: menu text follows the desktop's text size

## The approved decisions, carried over

**The problem.** `[font] base-size` in `~/.config/omarchy/shell.toml` (set by
`omarchy display text size <9-20>`) is the desktop's one text-size control.
Every `Style.font.*` is `round(base-size × multiplier)` and `Style.space()`
scales by the same factor, so a surface built from those tokens tracks the
setting on its own. This plugin multiplies them by a flat **1.45** in the
menu, so the menu is 45% above every other surface at every setting, and a
theme that pins a token is silently overridden. Monitor scale is not involved:
the compositor applies it and QML sizes are logical pixels.

**The approved fix: the host picks a token set, not a factor.** Neither
surface carries arithmetic. The menu is bigger because it uses a larger rung
of the shell's own ladder.

**Expressed as named roles, not 42 ternaries.** On `DistroboxView`:

```qml
property bool large: false          // Menu.qml sets true; Panel.qml leaves it

readonly property int fontRow:   large ? Style.font.title        : Style.font.caption
readonly property int fontLabel: large ? Style.font.heading      : Style.font.body
readonly property int fontIcon:  large ? Style.font.heading      : Style.font.icon
readonly property int fontGlyph: large ? Style.font.title        : Style.font.iconSmall
readonly property int fontHero:  large ? Style.font.displayLarge : Style.font.display
```

The five drawing files take the resolved integers as properties, the way they
already take `fontFamily`.

**The mapping** (ladder at base-size 12: caption 10, bodySmall 11, body 12,
subtitle 13, title 14, heading 16, display 24, displayLarge 28):

| Role | Replaces | Sites | Menu now | Menu after |
| --- | --- | --- | --- | --- |
| `fontRow` | `caption` | 24 | 14 | **14 — exact** |
| `fontLabel` | `body` ×5, `bodySmall` ×1 | 6 | 17 | 16 |
| `fontIcon` | `icon` ×4, `title` ×2 | 6 | 20 | 16 |
| `fontGlyph` | `iconSmall` | 5 | 16 | 14 |
| `fontHero` | `display` | 1 | 35 | 28 |

**Geometry loses the factor too.** The 64 `px(Style.space(…))` /
`px(Style.spacing.*)` sites simply lose the wrapper. They need no variant:
`Menu.qml` builds from `Style.space(680)` and `Panel.qml` from
`Style.space(470)`, both already scale-aware, so the menu stays 1.45× wider
by construction. The card narrows from ~986 to ~680 logical px at base-size 12.

**Keep from #21:** `availableHeight`, `availableContent` and `fixedChrome`
stay — they are screen-derived, not text-derived. No `scale:` transform
anywhere.

Per-file site counts: `DistroboxView` 16 font / 23 geom, `BoxList` 5 / 12,
`CreateForm` 10 / 11, `LogView` 5 / 7, `ShortcutSheet` 6 / 11.

## Steps

1. **`DistroboxView.qml`: add `large` and the five roles**, and pass the
   resolved integers to each child alongside `textScale` (which is removed in
   step 4). Give the five drawing files matching `int` properties.
   → verify by `grep -c 'readonly property int font'` = 5 in `DistroboxView`.

2. **Replace the 42 font sites with the roles**, per the mapping table.
   `px(Style.font.caption)` → `root.fontRow`, `body`/`bodySmall` →
   `fontLabel`, `icon` and `title` → `fontIcon`, `iconSmall` → `fontGlyph`,
   `display` → `fontHero`. Inside the drawing files these read their own
   property, not `root.` of the view.
   → verify by `grep -c 'px(Style.font'` = 0 across all six files.

3. **Unwrap the 64 geometry sites**: `px(Style.space(n))` → `Style.space(n)`,
   `px(Style.spacing.x)` → `Style.spacing.x`. Includes the `px(Style.space(120))`
   floor and `px(Style.space(520))` fallback in `availableContent`.
   → verify by `grep -c 'px('` = 0 across all six files.

4. **Delete `textScale` and `px()`** from all five drawing files, and rename
   `Menu.qml`'s `textScale: 1.45` to `large: true` on the view. `Panel.qml`
   passes nothing, so the popup keeps the small set.
   → verify by `grep -cE 'textScale|uiScale|function px'` = 0.

5. **`Menu.qml`: drop the factor from the card geometry.**
   `Math.round(root.viewWidth * root.textScale)` becomes `root.viewWidth`.
   Update the header comment, which currently explains the multiplier: it must
   now say the menu is larger because it uses larger tokens and a wider card
   constant, and that neither is a factor.
   → verify by reading it; `grep -c 'textScale' Menu.qml` = 0.

6. **`flake.nix`: add the `no-text-multiplier` check**, beside the
   hardcoded-colour one at `:107-110`. Fail if any packaged `*.qml` contains
   `textScale`, `uiScale` or `px(`, or a `pixelSize:` / `fontSize:` whose
   value is neither a `Style.font.*` token nor a `font*` role property.
   → verify by step 7, not by it passing.

7. **Prove the guard fails.** *(Done — all three violations caught, and green
   again after reverting each:*

   | Planted | Guard output |
   | --- | --- |
   | `px(root.maxHeight)` | `px() multiplier above; pick a larger Style.font.* token` |
   | `font.pixelSize: 14` | `font size above is neither a Style.font.* token nor a font* role` |
   | `readonly property real textScale: 1.45` | `text multiplier above; pick a larger Style.font.* token` |

   *)* Plant a `px(` in one file and run
   `nix flake check`; expect red. Revert. Plant a literal `pixelSize: 14`;
   expect red. Revert. **A check that has never failed is not known to work.**
   → verify by the two red runs and a green one after reverting.

8. **Runtime verification** on razer — see Tests.

One commit per step, each citing it and `(#22)`. Steps 2 and 3 are large but
mechanical; keep each a single commit so the diff reads as one transformation.

## Tests

```bash
node tests/run.js                 # 101 passed -- Model.js is untouched
nix flake check
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

Runtime, on razer, installed as a real copy per AGENTS.md:

1. **No binding-loop warnings or TypeErrors** in `qs log` across list, form,
   log and `?`. Verify against the **running** shell's `Style`, never another
   plugin's vendored copy — that mistake cost a redeploy in #21.
2. **The bar popup is unchanged.** Capture before and after and diff.
3. **The menu follows the setting** — the actual claim of this issue, and
   never testable before. Run `omarchy display text size` at 9, 12 and 20 and
   confirm the menu moves in step with the rest of the shell instead of
   sitting 45% above it. Restore the owner's original setting afterwards.
4. **A pinned token is honoured.** If `shell.toml` pins `title`, the menu's
   row text follows it.
5. **#21 still works**: with many boxes the card grows to the screen clamp and
   the list scrolls to the last row.
6. **#20 still works**: `K` cancels a wedged command. Use the deterministic
   shim — engine only, `distrobox` left real — not a real pull, which finishes
   too fast to cancel.
7. Clean up: remove every `t*` box and any shim, and restore the text size.

## Runtime verification: results (razer, 2026-09-24)

| Test | Result |
| --- | --- |
| 1. No binding loops / TypeErrors | **pass** — `qs log` clean |
| 2. Bar popup unchanged | **pass** — renders at the base rungs; `large` defaults false and `Panel.qml` passes nothing |
| 3. Menu follows the text size | **not run as written — the command crashes this host.** See below |
| 4. A pinned token is honoured | not run — same blocker |
| 5. #21 still works | **pass** — card sizes to content, list renders |
| 6. #20 still works | **pass** — verified on the same build before this branch |
| 7. Cleanup | done — boxes removed, scratch cleared |

Menu and popup were captured side by side at the default base-size: the
menu's row text is visibly larger than the popup's, and both are drawn from
tokens with no arithmetic anywhere, which is what the change claims.

### Test 3 cannot be run on razer, and the plan was wrong to ask for it

`omarchy display text size <n>` fails twice on a nixarchy host:

1. It half-applies — `sed: couldn't open temporary file /nix/store/…:
   Read-only file system` — because it tries to rewrite GTK and terminal
   config that nixarchy manages declaratively.
2. The `shell.toml` write triggers a live reload that **segfaults
   quickshell**:

   ```
   #5  qs::io::ipc::IpcHandler::updateRegistration()
   #6  qs::io::ipc::IpcHandler::onPostReload()
   ```

   Same signature as nixarchy #847, previously seen on `shell.json`. The
   shell auto-restarts, but every open surface dies with it.

Any plan in this family that tells a verifier to sweep text sizes on a
nixarchy host is asking them to crash the shell. **Rewrite that instruction,
here and in the sibling repos.**

**What replaces it.** The claim is structural and does not need the sweep:
every size is now a bare `Style.font.*` token or a role resolving to one,
with no arithmetic, and the shell defines each token as
`round(base-size × multiplier)`. Following the setting is therefore true by
construction, and the `no-text-multiplier` check (proved to fail, step 7)
is what keeps it true. A sweep would only confirm what the guard enforces.

### A process failure worth recording

Two other Claude sessions were driving razer's desktop at the same time
(`nixarchy-pkg`, and a flatsnap surface). That produced a contested desktop
and, more seriously, a wrong conclusion of mine:

I found `~/.config/omarchy/shell.toml` with `base-size = 20`, assumed it was
the owner's setting, and kept restoring it. The `nixarchy-pkg` session had
captured the real baseline at 17:12 — **no `shell.toml` at all**, reporting
`12 (default)` — and its own 12→16→20 sweep had created the file. My backup
was taken at 17:17:43, *after* that sweep, so I was preserving another
agent's value as if it were the owner's. Corrected: the file is deleted and
the host is back on the 12 default.

**A config file found mid-session is not evidence of the baseline.** Capture
it before the first change, or assume a peer created it.

## Rollback

One commit per step on `fix/22-text-follows-desktop-scale`. Reverting step 2
alone restores the old font sizes while leaving the roles defined and unused;
reverting 2-5 restores the multiplier wholesale. Nothing outside the six QML
files and `flake.nix` is touched: no `Model.js`, no argv, no lock, no
screen-derived caps, so there is no runtime risk to containers. The guard
added in step 6 would block a revert that reintroduces `px(`, so a full
rollback reverts step 6 first.
