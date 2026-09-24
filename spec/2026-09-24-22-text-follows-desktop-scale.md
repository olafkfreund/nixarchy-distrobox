---
status: approved
issue: 22
intent: intent/2026-09-24-22-text-follows-desktop-scale.md
---

# Spec: menu text follows the desktop's text size

## Design

**Decided at intent approval:** the host picks a **token set**, not a factor.
Neither surface carries arithmetic; the menu is bigger because it uses a
larger rung of the shell's own ladder.

### Named size roles, not 42 ternaries

The approved option was `large ? Style.font.title : Style.font.caption` at
each site. Done literally that is a ternary at all 42 text sites, which is
noisy and easy to get inconsistent. The same decision is better expressed as
a handful of **named roles** resolved once on `DistroboxView`:

```qml
property bool large: false          // Menu.qml sets true; Panel.qml leaves it

readonly property int fontRow:   large ? Style.font.title       : Style.font.caption
readonly property int fontLabel: large ? Style.font.heading     : Style.font.body
readonly property int fontIcon:  large ? Style.font.heading     : Style.font.icon
readonly property int fontGlyph: large ? Style.font.title       : Style.font.iconSmall
readonly property int fontHero:  large ? Style.font.displayLarge: Style.font.display
```

Each site then reads one name, and the five drawing files take the resolved
integers as properties (as they already take `fontFamily`). Six declarations
replace 42 ternaries, the roles say what the text *is* rather than how big it
is, and a future change happens in one place.

### The mapping, at the default base-size 12

The shell's ladder: `caption` 10, `bodySmall` 11, `body` 12, `subtitle` 13,
`title` 14, `heading` 16, `display` 24, `displayLarge` 28.

| Role | Sites | Popup token | Menu token | Menu now (×1.45) | Menu after |
| --- | --- | --- | --- | --- | --- |
| `fontRow` | 24 | `caption` 10 | `title` 14 | 14 | **14 — exact** |
| `fontLabel` | 5 `body` + 1 `bodySmall` | `body` 12 | `heading` 16 | 17 | 16 (−1) |
| `fontIcon` | 4 `icon` + 2 `title` | `icon` 14 | `heading` 16 | 20 | 16 (−4) |
| `fontGlyph` | 5 | `iconSmall` 11 | `title` 14 | 16 | 14 (−2) |
| `fontHero` | 1 | `display` 24 | `displayLarge` 28 | 35 | 28 (−7) |

The body text most of the menu is made of lands **exactly** where it is
today. The larger decorative sizes come down, which is the point: the ladder
has no rung at 1.45× and inventing one is what this removes. Flatsnap
accepted the same rounding.

### Geometry loses the factor too

The 25 `px(Style.space(…))` and 39 `px(Style.spacing.*)` sites simply lose
their wrapper. They do **not** need a large/small variant, because the two
surfaces already differ by constant: `Menu.qml` builds its card from
`Style.space(680)` and `Panel.qml` from `Style.space(470)`. Both already
scale with base-size, so the menu stays wider than the popup and both follow
the setting — with no multiplier.

The menu card narrows from ~986 to ~680 logical px at base-size 12. That is
the honest consequence of removing a factor that was never scale-aware, and
it is still 1.45× the popup by construction.

### What #21 must keep

`availableHeight` / `availableContent` / `fixedChrome` stay exactly as they
are: they are screen-derived, not text-derived, and they are what makes the
surfaces follow the monitor. `px()` disappears from them along with
everything else, so `px(Style.space(120))` becomes `Style.space(120)`.

No `scale:` transform is reintroduced anywhere.

### The guard

A `no-text-multiplier` check in `flake.nix`, beside the hex-colour one,
failing if any packaged `*.qml` contains `textScale`, `uiScale`, `px(`, or a
`pixelSize:`/`fontSize:` whose value is not a `Style.font.*` token or one of
the view's `font*` role properties. Copied from flatsnap, but across **all
six files**, not just `Menu.qml`, because this plugin's sizing lives in the
drawing files.

## Alternatives rejected

- **A ternary at each of the 42 sites.** The approved shape, taken literally.
  Rejected in favour of named roles, which express the same decision with six
  declarations and make the next change one edit. Same behaviour.
- **Menu tokens for both surfaces.** Simplest diff, but the bar popup would
  grow from `caption` to `title` and out-size every other bar widget. The
  intent forbids changing the popup.
- **Text only, geometry keeps 1.45.** Keeps the card exactly as it looks
  today, but leaves a flat factor in the tree, so the guard could only cover
  fonts and the factor would creep back. Also makes text and card scale by
  different rules.
- **Keeping `px()` with a scale-aware factor** (deriving 1.45 from base-size).
  Still a multiplier, still overrides a theme that pins a token, and still has
  no rung on the ladder to land on.

## Risks

- **The menu gets visibly smaller**, most noticeably the hero glyph (35 → 28)
  and the action icons (20 → 16). This is intended, but it is the change a
  user will notice first, so it belongs in the PR description and not only in
  a table here.
- **`fontIcon` merges two tokens.** `icon` (4 sites) and `title` (2 sites)
  both become one role. Checked: the two `title` sites are the box-name text
  at `DistroboxView.qml:407` and the confirmation message at `:792` — both
  "prominent text", which is what `fontIcon`'s menu token (`heading`) suits.
  If they read wrong at runtime they get their own role; that is a one-line
  change.
- **A theme that pins `title` or `heading`** now moves the menu. That is the
  point, but it means the menu's size is no longer fully under this plugin's
  control.
- **Regression risk to #21 and #20** is low: no change to `Model.js`, to argv,
  to the lock, or to the screen-derived caps. But both merged very recently,
  so the runtime check must cover cancel and the caps, not just text.
- Host: nixarchy desktops.

## Verification

1. `node tests/run.js` — 101 still green (`Model.js` untouched).
2. `nix flake check`, `--all-systems --no-build`, `nix build`,
   `omarchy plugin validate` on a fresh clone.
3. **The new guard actually fails**: plant a `px(` and a literal
   `pixelSize: 14` and confirm `nix flake check` goes red for each, then
   revert. A check that has never failed is not known to work.
4. **No binding-loop warnings** in `qs log` across list, form, log and `?`.
5. **The bar popup is unchanged** — capture before and after and diff.
6. **The menu follows the setting**: run `omarchy display text size` at 9, 12
   and 20, and confirm the menu moves in step with the rest of the shell
   rather than sitting 45% above it. This is the actual claim of the issue and
   was never testable before.
7. **#21 and #20 still work**: the card still grows to the screen clamp with
   many boxes and the list still scrolls; `K` still cancels a wedged command.
8. `docs/usage.md` and `README.md` only if something user-visible changes;
   text size is not documented there today.
