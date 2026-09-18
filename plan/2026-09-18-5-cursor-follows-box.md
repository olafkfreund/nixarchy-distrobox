---
status: approved
issue: 5
spec: spec/2026-09-18-5-cursor-follows-box.md
---

# Plan: the cursor stays on the same box when the list re-sorts

## Approved decisions (self-contained summary)

- **Follow the box on every refresh.** If it disappears, keep the row number,
  clamped (today's behaviour).
- **`Model.js`:**
  - `cursorAfter(prevKey, rows, prevIndex)` returns the index of the row whose
    `key === prevKey`. Otherwise it returns `clampCursor(prevIndex,
    rows.length)`, and `0` for an empty list.
- **`DistroboxView.qml`:**
  - a new `cursorKey` property, stored and not bound;
  - `rememberCursor(index)` clamps, sets `cursorIndex`, and sets `cursorKey`
    to that row's key while `cursorActive` (otherwise `""`);
  - `onRowsChanged` calls
    `rememberCursor(Model.cursorAfter(cursorActive ? cursorKey : "", rows, cursorIndex))`;
  - `moveCursor()` and `setCursor()` go through `rememberCursor`;
  - stepping up into the filter, `reset()`, and the filter's `onTextChanged`
    clear `cursorKey` first, then `rememberCursor(0)`;
  - an empty list leaves `cursorActive` as it is.
- **`BoxList.qml`:** `cursorRequested(string key)` is emitted with the row's
  key. The view resolves it against the current rows and ignores a key no
  longer listed.
- **Out of scope:** telling real pointer movement apart from a row sliding under
  a parked pointer. It is recorded if seen.

## Steps

Each step is one commit on `fix/5-cursor-follows-box`, citing `plan step N`. A
deviation updates this file in the same commit.

1. **`Model.js` `cursorAfter`, plus tests in `tests/model/rows.test.js`.** The
   tests cover:
   - a moved key (up and down), and an unmoved key;
   - a removed key (clamped, including past the end);
   - an empty list, and no key;
   - a `rowsFor` re-sort after a start;
   - the fallback sequence (the key is gone, the fallback row's key is
     remembered, and a later re-sort follows it).

   → Verify: `node tests/run.js` passes, and the old 56 tests still pass.
2. **`DistroboxView.qml` and `BoxList.qml` wiring** as above.
   → Verify:
   - `grep` finds no assignment to `cursorIndex` outside `rememberCursor`;
   - `cursorRequested` carries a string;
   - `nix flake check` passes.
3. **Live checks, in the popup and in the menu.**
   - **Setup:** stage with `docs/capture.sh --setup`, on an empty workspace,
     with keys only through the layer guard (AGENTS.md, "Retaking the
     captures"). The owner steps away for about 10 minutes, and is asked
     first.
   - **Checks:**
     1. Cursor on a stopped box below a running one, then `s`. Once it is
        running and has moved up, the highlight, `y` (compare the clipboard),
        Enter (compare the terminal window's box) and `x` (the dialog's name,
        then cancel) all name that box.
     2. The same, with the cursor placed by hover.
     3. Delete the selected box from a terminal: the cursor moves to the next
        row.
     4. Filter to nothing, then clear: the cursor is on row 0.
     5. An inactive cursor stays inactive through 3 s refreshes.
     6. A parked pointer over a row during a re-sort: record what happens.
   - **Afterwards:** `--teardown`, and diff against the snapshot.

   → Verify: every check is recorded in the implementation record.
4. **PR** (`Closes #5`) linking the three artifacts. Merge once CI is green.
   → Verify: the PR is merged, the issue is closed, and the change is on
   `origin/main`.

The host rollout is not here: it happens once, at the end of #4's plan, and
carries both fixes.

## Tests

- **A.** `node tests/run.js`: the new `cursorAfter` cases pass, along with the
  existing 56.
- **B.** `nix flake check`, and `nix build` still produces 12 files.
- **C.** Live checks 1–6 in the popup and the menu, with results recorded.

## Rollback

- **Before merge:** close the PR, and delete the branch.
- **After merge:** `git revert` the merge commit.
- **The live test's demo boxes:** `docs/capture.sh --teardown`.

## Implementation record

### Deviations

1. **The live checks for #4 and #5 run as one session**, from a throwaway
   combined build of both branches (never pushed), so the owner steps away
   once. On p620 the plugin's Nix link is swapped for the test copy for the
   session and restored to the same store path afterwards.
2. **The first live session was halted: another agent was testing on the same
   desktop.** During the session the shell was restarted, not by this task, and
   a `nixarchy.microvm` bar popup opened where ours had been, showing its own
   delete dialog. The key guard checked only the generic
   `omarchy-keyboard-panel` layer, which every bar popup uses, so one `y` may
   have reached the other plugin's panel. No x, Enter or Space did, and the
   dialog was left untouched (Cancel focused) and closed by its owner.

   All input stopped. The collision was posted on the agent bus, the session
   torn down, and the desktop restored. The box list, `shell.json`, the menu
   file and the plugin's Nix link are identical to the snapshot; DND is off
   and the workspaces are back.

   **The guard for the rerun:** type only while this plugin's own `status`
   reports `views == 1` *and* the popup layer is up. Opening another bar
   popup closes ours, which stops the keys. Also announce the input session
   on the bus before starting.

3. **Checks 2 and 6 could not be exercised.** The rerun (2026-09-19, one
   session with #4, #7 and #8, the owner away) places the pointer with
   Hyprland's `cursor.move` dispatch. A dispatched move produces no hover
   event in the layer, so hover never selected a row. Both paths go through
   the same `cursorRequested(key)` signal that the keyboard path uses, which
   check 1 covers.
4. **Check 1: Enter was not exercised.** It opens a terminal outside the
   guarded layer. Enter reads the same `rows[cursorIndex]` as `y` and `x`,
   which were both checked.

### Test results

- **Step 1:** `node tests/run.js` passes, with the new `cursorAfter` cases
  and the existing 56.
- **Step 2:** the grep finds no assignment to `cursorIndex` outside
  `rememberCursor`, and `nix flake check` passes.
- **Step 3 (live, p620, the popup; guard from deviation 2 in force):**
  1. **Pass.** The cursor was on `demo-ubuntu` (stopped, row 3); after `s` it
     moved up to row 2 and the highlight moved with it. `y` copied
     `demo-ubuntu` both times, and `x`'s dialog named `demo-ubuntu`, then
     Cancel. Also seen: a stop moved `demo-fedora` down, and the cursor
     followed it.
  2. Not exercisable (deviation 3).
  3. **Pass.** A box deleted from a terminal: the cursor clamped to the next
     row (`demo-broken`).
  4. **Pass.** Filter to nothing, then clear: the cursor is on row 0.
  5. **Pass.** An inactive cursor stays inactive through 3 s refreshes.
  6. Not exercisable (deviation 3).
- **Afterwards:** `capture.sh --teardown`. The box list, the distrobox homes,
  `shell.json`, the menu file and the plugin's Nix link are identical to the
  snapshot, and the clipboard, DND and workspaces are restored.
