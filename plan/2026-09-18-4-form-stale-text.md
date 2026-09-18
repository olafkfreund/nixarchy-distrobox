---
status: approved
issue: 4
spec: spec/2026-09-18-4-form-stale-text.md
---

# Plan: the create form opens empty every time

## Approved decisions (self-contained summary)

- **No drafts.** Every open shows `Model.emptyForm()`: empty, apart from the
  default image.
- **`CreateForm.qml`:**
  - each text field has
    `text: fieldItem.takesText ? String(root.form[fieldItem.modelData.key] || "") : ""`;
  - `onTextEdited` keeps feeding the exact edited text to `setValue` (never
    `onTextChanged`);
  - remove the `Component.onCompleted` text write, `setText()`, and
    `pickImage()`'s lookup and direct write (`pickImage` keeps `setValue` and
    the `imageIndex` reset);
  - `setValue` keeps its whole-object replacement;
  - focus is untouched.
- **Fallback,** if the binding moves the text cursor or drops keys in the
  installed Qt: `start()` reseeds every surviving delegate's text before the
  deferred focus, and `pickImage` keeps its direct write. It is recorded as a
  deviation.
- **If the keyboard Advanced toggle loses focus** (checked live), add
  `Qt.callLater(root.focusCurrent)` after the toggle. That would be a recorded
  deviation too.
- **Host rollout, once, carrying #5 and #4:** bump the `nixarchy-distrobox`
  input in nixos_config, then switch p620 and razer. This is the last step
  below.

## Steps

Each step is one commit, citing `plan step N`. Steps 1–4 are on
`fix/4-form-stale-text`, rebased onto `main` after #5 merges. A deviation updates
this file in the same commit.

1. **`tests/model/form.test.js`:** `emptyForm()` returns an independent object
   (mutate one, and the next call still has every default).
   → Verify: `node tests/run.js` passes.
2. **`CreateForm.qml`: the binding, and the removed writes,** as above.
   → Verify:
   - `grep` finds no `input.text =`, `setText` or `text = String(` left in
     `CreateForm.qml`;
   - `nix flake check` passes.
3. **Live checks, in the popup and in the menu.** This is the same capture
   discipline as #5 (demo boxes, an empty workspace, keys only through the layer
   guard, the owner away and asked first, teardown and a snapshot diff).
   1. Type a name, image, home and packages, then Esc, then reopen **with
      Advanced closed**. All fields show the defaults.
   2. The same after a real create of `demo-new`.
   3. Pick an image, edit it, reopen: the default image.
   4. Advanced: type in Volumes, cancel, reopen, open Advanced: empty.
   5. Mid-text insertion, select-and-replace, and paste: the cursor stays in
      place and no keys are lost.
   6. Space on the Advanced row, then Tab: focus is in Hostname.
   7. IPC `create` from the bar and from the menu, then type at once: the text
      is in Name.
   8. `qs log`: no binding-loop warnings.

   → Verify: every check is recorded. A failure of 5 triggers the fallback; a
   failure of 6 triggers the focus fix.
4. **PR** (`Closes #4`) linking the three artifacts. Merge once CI is green.
   → Verify: merged, the issue is closed, and the change is on `origin/main`.
5. **Host rollout, carrying #5 and #4** (a flake lock bump, exempt from the
   artifact gates).
   1. Announce on the agent bus.
   2. In `~/.config/nixos` on `main`: stash **only** the other agent's pending
      `nixarchy-voice` lock change.
   3. `nix flake update nixarchy-distrobox`.
   4. Check that the lock diff touches only that node.
   5. Commit (`chore(flake): bump nixarchy-distrobox (#4, #5)`) and push.
   6. **Pop the stash before any build.** p620 is running that agent's bump,
      so building without it would roll it back again.
   7. Build-test p620, then switch it.
   8. Switch razer through p620, after checking razer's NVIDIA module against
      userspace.

   → Verify:
   - on both hosts, the plugin's store path is the new rev;
   - `omarchy-voice.service` on p620 still runs `ciz5ma6g…`;
   - 0 failed units;
   - a reopen of the create form shows empty fields;
   - the pending bump is back in the working tree, uncommitted.

## Tests

- **A.** `node tests/run.js` passes.
- **B.** `nix flake check`, and `nix build` still produces 12 files.
- **C.** Live checks 1–8 in the popup and the menu.
- **D.** The rollout's end-state checks (step 5).

## Rollback

- **Before merge:** close the PR.
- **After merge:** `git revert` the merge commit.
- **Hosts:** `git revert` the lock-bump commit and switch again, or
  `sudo nixos-rebuild switch --rollback` on each host.
- **The pending `nixarchy-voice` bump** is never committed here. If a stash pop
  ever conflicts, the stash is left in place and reported.

## Implementation record

### Deviations

_None yet._

### Test results

_Pending._
