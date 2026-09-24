---
status: approved
issue: 23
spec: spec/2026-09-24-23-cancel-reaches-the-engine.md
---

# Plan: a cancel stops the work, not just the command

## The approved decisions, carried over

**The problem.** `Quickshell.Io.Process` has no `kill()`, so #20's `cancel()`
sets `running = false`, which SIGTERMs only the process the plugin spawned.
`distrobox create` spawns the engine, so the engine is a **grandchild** and
survives. Measured: direct child gone, `podman` still pulling. `K` returns
the panel while the download continues with nothing on screen to say so.

**The approved fix: chase, not prevent.** Kill the descendants at cancel
time. Nothing changes about how commands are spawned.

**Why not prevention** (recorded so it is not revisited from intuition; both
halves measured): Quickshell does **not** isolate `Process` children — the
shell and all six of its children share `pgid=3083161` — and because those
children are therefore not group leaders, `setsid` does **not** fork today
(tracked pid == exec'd pid, verified). A `setsid` prefix would work *now*,
and that is the trap: if Quickshell ever starts isolating children, our
`setsid` forks, `processId` becomes a wrapper that exits at once, `running`
goes false, and **the lock releases while the work continues** — #20's exact
failure, reintroduced silently, with no test going red.

**`kill -- -<processId>` is catastrophic here** and must never be used: every
`Process` child shares the shell's pgid, so it would signal the shell's own
group and take down the shell and every other plugin's helpers.

**The ordering is the correctness argument.** `pkill -P` selects by *parent*
PID. Once the parent dies its children are reparented to init and the link is
gone. So the kill runs **before** `running = false`. Reversing it leaves the
pull running **and still looks correct**, because the lock releases either
way — the same shape as #20's "clear the queues first".

**The ceiling:** `pkill -P` is **one level**, not recursive. It covers the
measured tree (`distrobox create` → `podman pull`). This must be said at the
call site, because a reader who assumes recursion will be wrong.

**Not done:** no SIGKILL escalation (needs a timer; #20 has none by design),
no cleanup of partial boxes or images (#20 decided that), no extra handling
for `upgrade all` (the queue is already cleared by `cancel()`).

## Steps

1. **`Model.js`: add `killChildrenArgv(pid)`** returning
   `["pkill", "-P", String(pid)]`, or `null` unless `pid` is a positive
   integer, so an unset `processId` cannot produce an argv. Comment why it is
   by PID and never by pattern (AGENTS.md records `pkill -f` killing the
   shell that issues it).
   → verify by new rows in `tests/model/commands.test.js`: a valid pid, and
   `null` for `0`, `-1`, `undefined`, `"1; id"` and a float.

2. **`DistroboxState.qml`: add `Process { id: killProcess }`**, mirroring the
   existing fire-and-forget `copyProcess` (`:439`).
   → verify by grep.

3. **`DistroboxState.qml`: kill the descendants inside `cancel()`**, for the
   chosen target's process, **before** its `running = false`. Carry a comment
   stating both the ordering reason and the one-level ceiling.
   → verify by reading: the `killProcess` line precedes `running = false` in
   both the stream and action branches.

4. **`docs/usage.md`:** the troubleshooting entry at `:285-292` says `K`
   "stops whatever is running" and "does not tidy up". Update it to say the
   engine it started is stopped too, while keeping the existing warning that a
   half-made box is left behind — the point of this issue is not to overclaim.
   → verify by reading.

5. **AGENTS.md / README requirements:** `pkill` becomes an external command
   the plugin needs. A missing command fails silently inside a QML `Process`,
   so it is documented like the others.
   → verify by grep for `pkill` in the requirements list.

6. **Runtime verification** on razer — see Tests.

One commit per step, each citing it and `(#23)`.

## Tests

```bash
node tests/run.js                 # new killChildrenArgv rows + the existing 101
nix flake check                   # incl. #22's no-text-multiplier
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

Runtime, on razer, installed as a real copy per AGENTS.md. **Check first that
no other Claude session is driving that desktop** — `ListAgents` plus a
message to the sibling sessions; a duplicated bar or a foreign menu in a
capture means someone else is on it.

1. **The measured failure is fixed.** Reuse #20's deterministic setup: shim
   **only** the engine to `sleep 999`, leave `distrobox` real, so the tree is
   `shell → distrobox (real) → engine (hangs)`. Record both PIDs before `K`,
   then confirm **both are gone** after. Under #20 the grandchild survived —
   that is the before/after, and a real image pull is useless here because it
   finishes faster than the cancel.
2. **Nothing else dies.** Immediately after the cancel, confirm the shell is
   still up and its other `Process` children (`inotifywait`, `wl-paste`,
   `gdbus`) are still running. This is the specific catastrophe a
   process-group kill would have caused, so it is checked explicitly.
3. **#20 does not regress**: the lock releases immediately, a fresh `s` is
   accepted, the notice still reads "… cancelled" rather than "failed", and
   cancelling mid-`upgrade all` still leaves the queue stopped.
4. **`K` with nothing running** is still a silent no-op (`killChildrenArgv`
   returns `null` on an unset pid).
5. `qs log` clean of binding loops and TypeErrors.
6. **Do not run a text-size sweep.** `omarchy display text size` half-applies
   against the read-only store and then segfaults quickshell via
   `IpcHandler::onPostReload` (nixarchy #847).
7. Clean up: remove every `t*` box and the shim, and leave no `shell.toml`
   behind — that file does not exist on this host's baseline.

## Rollback

One commit per step on `fix/23-cancel-reaches-the-engine`. Reverting step 3
alone restores #20's behaviour exactly — the engine survives again, but the
lock still releases, so the plugin is never worse than it is today. `Model.js`
gains a pure function that nothing else calls, and no argv that reaches
`distrobox` changes, so there is no risk to containers from the revert or from
the change. The new `killProcess` is fire-and-forget, so a hung `pkill` cannot
hold the lock either way.
