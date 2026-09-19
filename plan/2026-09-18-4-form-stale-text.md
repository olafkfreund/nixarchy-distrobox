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
3. **Step 5's stash handling no longer applies.** Another agent
   (`p620-11c0b1`) deployed `main` to p620 and razer, and moved the pending
   `nixarchy-voice` lock bump into `git stash` in `~/.config/nixos`, labelled.
   p620 now runs `main` (voice d8340f9), and the working tree is clean. So step 5
   becomes:
   1. Check the tree is clean and on `main`.
   2. `nix flake update nixarchy-distrobox`, and check that the lock diff touches
      only that node.
   3. Commit and push.
   4. Build-test, then switch p620 and razer.

   **Leave that stash alone:** it belongs to the other agents, and applying it
   would deploy their change without them. Before switching, compare
   `/run/current-system` with a build of `main`, so the only difference is the
   plugin's rev.

4. **Step 5 carries #7 and #8 as well.** Those features were approved while
   #4 and #5 waited for the desktop, and were live-checked in the same session.
   So one lock bump carries all four, after all four PRs are merged. The commit
   is `chore(flake): bump nixarchy-distrobox (#4, #5, #7, #8)`. Before building
   from `main`, check that it contains the other agent's `nixarchy-microvm`
   input (nixos_config #1898). It does: that agent confirmed it on the bus
   (merge `e494e1154`), so a build from `main` keeps their plugin.

5. **Step 5 went through a PR, not a push.** `main` in nixos_config is
   protected, so the bump landed as nixos_config #1899 (merged `581eca601`),
   and both hosts were switched from that merged `main`.

### Test results

- **Step 1:** `node tests/run.js` passes, including the independent
  `emptyForm()` case.
- **Step 2:** the grep finds no `input.text =`, `setText` or `text = String(`
  left in `CreateForm.qml`, and `nix flake check` passes.
- **Step 3 (live, p620, 2026-09-19; one session with #5, #7 and #8, the owner
  away, the guard from deviation 2 in force).** All eight pass:
  1. Name, image, home and packages typed, then Esc, then reopen with Advanced
     closed: every field shows its default.
  2. The same after a real create of `demo-new`.
  3. A picked and edited image resets to the default image on reopen.
  4. Text in Volumes, cancel, reopen, open Advanced: Volumes is empty.
  5. A mid-text insert gives `abcX|def`, with the cursor in place and no keys
     lost. Select-and-replace and paste behave the same. The fallback is not
     needed.
  6. Space on the Advanced row, then Tab: focus is in Hostname. The focus fix
     is not needed.
  7. IPC `create` from the bar and from the menu, then typing at once: the text
     is in Name.
  8. `qs log`: 0 binding-loop warnings.
- **Afterwards:** `capture.sh --teardown`. The box list, the distrobox homes,
  `shell.json`, the menu file and the plugin's Nix link are identical to the
  snapshot, and the clipboard, DND and workspaces are restored.
- **Step 5 (host rollout, 2026-09-19, carrying #4, #5, #7 and #8):**
  - Announced on the agent bus before starting and before each switch.
    nixos_config `main` already had #1898, and its tree was clean. The other
    agents' `stash@{0}` was left untouched.
  - The lock diff touches only `nixarchy-distrobox`, 7e2a532 → 3dc1081. Both
    `just test-host` builds pass, and CI on #1899 is green for p510, p620 and
    razer.
  - `nix store diff-closures` from each host's running system to the new one
    shows only `nixarchy-distrobox`, so no other agent's change moved.
  - **p620:** `just p620` exit 0. The plugin links to
    `/nix/store/mwxsg42…-nixarchy-distrobox-0.1.0`, and there are 0 failed
    units. After one shell restart, an IPC `create` opens the form with empty
    fields, the Start from row, and focus in Name. No plugin errors in
    `qs log`.
  - **razer:** the NVIDIA module and userspace are both 610.57.04. The
    via-p620 rollout exits 0, with the same store link and 0 failed units.
    `status` answers with razer's own boxes. Its running shell was not
    restarted, because nobody was at razer; it loads the new code on its next
    shell start.
