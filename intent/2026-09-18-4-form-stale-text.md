---
status: draft
issue: 4
author: olafkfreund
---

# Intent: the create form opens empty every time

## Problem

The create form's text fields show what was typed the last time the form was open,
while the form's data behind them has been reset.

- `CreateForm.start()` (line 48) resets `root.form` to `Model.emptyForm()`.
- Each text field loads its text only once, in `Component.onCompleted` (line 328).
- The Repeater's model (`root.fields`) does not change between opens, so the field
  delegates, and their old text, survive every close.

What the user sees and what gets submitted fall out of step:

- **Typing appends to the stale text.** Found while recording the showcase (#3):
  `demo-new` became `demo-newdemo-new`, and the home path doubled.
- **Submitting a field that shows a name** validates the empty data, and reports
  "A name is required".

The live tests for #1 missed it because every form test there started right after
a shell restart, so every open was a first open.

## Proposed outcome

- Every time the form opens (`c`, IPC `create`, or the menu's `{"create":true}`),
  every field shows exactly the form's data: empty, except the default image.
- Opening, typing, cancelling and reopening shows an empty form, and so does
  reopening after a create. The same holds for fields under Advanced.
- The plan's live checklist gains a reopen test, so a fresh-shell-only test cannot
  hide this again.

## Affected users and systems

- This repository: `CreateForm.qml`, plus the plan's live checklist.
- Everyone using the plugin (p620 and razer, through the Nix input). They get the
  fix on the next input bump in nixos_config.

## Constraints

- The AGENTS.md rules. There is no QML test framework here, so this fix is proven
  by live checks. Any logic that can move into `Model.js` gets a Node test.
- Keep the form's keyboard behaviour exactly as it is: focus lands in Name on
  open, and IPC `create` keeps that focus.
- Separate from #5 (the cursor following the box), which is its own task.

## Open questions

1. **Should reopening ever keep a half-typed form** (a draft), for instance after an
   accidental Esc? Default: no. The issue is that what you see and what you submit
   differ; a draft feature would be a separate request.
