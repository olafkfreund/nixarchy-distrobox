---
status: approved
issue: 20
spec: spec/2026-09-24-20-operation-lock-watchdog.md
---

# Plan: cancel the running mutation

## The approved decisions, carried over

**The problem.** `DistroboxState.qml:72,85` derive the lock from the processes:
`mutating = actionProcess.running || streaming || queue.length > 0` and
`streaming = streamProcess.running || streamQueue.length > 0`. An exit therefore
always releases the lock — but nothing releases it when a command never exits.
There is no timeout, no `kill()` and no watchdog in the file (the only two
`Timer`s are the polls at `:97` and `:105`). A wedged podman/docker leaves
`mutating` true forever, every mutation refused from both surfaces, recoverable
only by restarting the shell.

**The approved fix: cancel, not a timeout.** A watchdog has to guess a duration
and every guess kills a legitimate slow pull or a long `upgrade all`. Cancel
never guesses and fully restores recoverability.

**The approved mechanism.** `Quickshell.Io.Process` exposes no `kill()` or
`signal()` — only a settable `running` and a read-only `processId`. Setting
`running = false` sends SIGTERM; `exited` fires; the lock releases through the
*derived* property that already exists. **No new state and no flag** — preserving
the derived lock is a hard requirement. The queues must be cleared in the same
step or `onExited` starts the next command.

**Approved details.** Key is `X`, in list mode and log mode. Cancel is not
confirmed. `busyText()` gains `, X to cancel` so the affordance appears exactly
when the user hits the lock. A partial `create` is **not** cleaned up
automatically — it is logged and left for the user's `x`.

## Steps

1. **`Model.js`: add `cancelTarget`** — a pure function returning
   `{ process: "stream" | "action", label }` or `null` when nothing is
   cancellable. Prefer `"stream"` when `streaming` is true, else `"action"` when
   `mutating`, else `null`. Label is `streamTitle` for a stream, otherwise
   `pendingVerb` + optional `pendingName`.
   → verify by new rows in `tests/model/commands.test.js` covering stream,
   action, nothing-running, and a blank label.

2. **`Model.js`: extend `busyText`'s source strings.** The suffix is
   `" — press o to watch, X to cancel"` for a stream and
   `" — X to cancel"` for an action. Keep the text in `Model.js`, not QML.
   → verify by an assertion on the exact strings.

3. **`DistroboxState.qml`: add `cancel()`.** Read `Model.cancelTarget(...)`;
   return false on null. Otherwise set `root.queue = []` and
   `root.streamQueue = []` **first**, clear `streamAll`, append
   `"── cancelled"` to the log when a stream is running, then set
   `running = false` on the chosen Process. Do not touch `mutating`.
   → verify by reading the file: no new boolean property is introduced.

4. **`DistroboxState.qml`: update `busyText()` (`:144`)** to use the step-2
   strings.
   → verify at runtime in step 10.

5. **`DistroboxView.qml`: bind `X` in `handleTextKey`** (`:249`), before the
   `cursorActive` guard so it works with no cursor:
   `if (key === "X") { DistroboxState.cancel(); return }`.
   → verify by grep that `X` appears in no other branch.

6. **`LogView.qml`: add a `cancelRequested()` signal** and
   `else if (key === Qt.Key_X && event.modifiers & Qt.ShiftModifier)` in
   `Keys.onPressed` (`:44`); wire it in `DistroboxView.qml` to
   `DistroboxState.cancel()`.
   → verify by pressing `X` in the log view at runtime.

7. **`Model.js`: add `X` to `SHORTCUTS`** in the Box group so `ShortcutSheet`
   and `?` list it without further change (the sheet renders
   `Model.shortcutGroups()` and cannot drift).
   → verify by opening `?` at runtime.

8. **`docs/usage.md` and `README.md`:** document `X`, and state plainly that
   cancelling a `create` can leave a partial box to remove with `x`.
   → verify by grep for `X` in both files.

9. **`manifest.json`:** add `X` to the `barWidget.description` key list.
   (Note: that description already omits `p` — issue for that separately, do
   not fix it here.)
   → verify by `jq -r '.barWidget.description' manifest.json`.

10. **Runtime verification** on a nixarchy desktop — see Tests.

One commit per step, each citing the step number and `(#20)`.

## Tests

```bash
node tests/run.js                              # new cancelTarget rows + existing 99
nix flake check
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
```

Expected: all green, `99 + n passed, 0 failed`.

Runtime, on a nixarchy desktop, installing a real copy per AGENTS.md
(`cp -rL result ~/.config/omarchy/plugins/nixarchy.distrobox`, `chmod -R u+w`,
`omarchy-restart-shell`, wait for `omarchy-shell shell ping`):

1. **The actual bug.** Put `sleep 999` earlier in `PATH` named as the engine,
   press `s` on a box. Expect the refusal to read `… X to cancel`. Press `X`.
   Expect the lock to release and a normal `s` to work — **without restarting
   the shell**.
2. **The queue.** Start `upgrade all` across three `t1`/`t2`/`t3` boxes, cancel
   during the first. Expect the remaining boxes **not** to start, and the lock to
   release.
3. **The SIGTERM risk (the open question).** Cancel a real `create` mid-pull,
   then `ps` for the engine child. **Record the answer in this plan.** If the
   child survives, note it as a follow-up for a `processId`-based escalation —
   do not implement it here.
4. **Both surfaces.** Cancel from the bar popup, confirm the menu is unlocked,
   and the reverse. Confirms the singleton is genuinely shared.
5. **Nothing running.** Press `X` with no operation in flight; expect nothing to
   happen and no error text.
6. `qs log -i <instance>` clean of warnings.

Clean up with `distrobox rm` for every `t*` box.

## Rollback

Each step is its own commit, so `git revert` of any one is safe. The branch is
`fix/20-operation-lock-watchdog`; abandoning it changes nothing, since no
existing behaviour is modified — `cancel()` is additive and `busyText()` only
gains a suffix. If cancel proves to leave orphaned engine children (test 3) the
feature still stands: the lock releases, which is the shipped fix.
