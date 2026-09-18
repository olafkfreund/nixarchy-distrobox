---
status: approved
issue: 5
author: olafkfreund
---

# Intent: the cursor stays on the same box when the list re-sorts

## Problem

The list sorts running boxes first, then failed ones, then the rest by name. When a
start or stop finishes, the list refreshes and re-sorts, and the box that changed
state moves. The cursor does not move with it: `DistroboxView.qml` keeps a row
*number* (`cursorIndex`), and `onRowsChanged` (line 52) only clamps that number to
the list length.

So the next key acts on whichever box now sits in that row. This was seen while
recording the showcase (#3):

- the cursor was on `demo-new` (row 4), and `s` started it;
- once running, `demo-new` moved to row 2, and `demo-broken` moved into row 4;
- Enter then opened a terminal on `demo-broken`, not on the box just started.

The same shift can happen on any refresh that reorders rows: a box started or
stopped from the other surface or from a terminal, or a box created or deleted.
For `x`, the only guard is that the confirm dialog names the box, and a user
pressing Enter on a Cancel-default dialog is safe, but one reading quickly and
confirming is not.

## Proposed outcome

- The cursor follows the **box** it is on across every refresh and re-sort. After
  `s` finishes, Enter acts on the box that was started.
- If that box is gone (deleted, or filtered out), the cursor falls back to the
  nearest valid row, as it does today.
- Typing in the filter still resets the cursor to the top, as it does today.
- The rule lives in `Model.js`, with Node tests, as the repository requires.

## Affected users and systems

- This repository: `Model.js`, `DistroboxView.qml`, `tests/model/`, and the
  plan's live checklist.
- Everyone using the plugin (p620 and razer, through the Nix input). They get the
  fix on the next input bump in nixos_config.

## Constraints

- The AGENTS.md rules: logic in `Model.js` with a Node test; QML only wires it.
- Mouse hover still moves the cursor to the hovered row, as it does today.
- No change to sorting itself. Running-first stays; only the cursor follows.
- Separate from #4 (the stale create-form text), which is its own task.

## Open questions

1. **Follow the box on every refresh, or only after the user's own action?**
   Default: every refresh, since a box can move because of something another
   surface or a terminal did.
2. **When the followed box disappears,** keep the same row number, clamped to
   the list (today's behaviour), rather than jump to the top. Default: keep the
   row number.
