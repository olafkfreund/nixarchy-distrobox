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

**REVISED after step 6 measured the real tree** (see the spec). Steps 1-5 below
implemented chase; they are superseded. Chase reached level 2 of a four-level
bash chain, so the engine survived and the fix did not work. All four levels
share the shell's pgid, so nothing could be salvaged inside that design.

Steps 1-5 are reverted and replaced by:

1r. **`Model.js`: add `detached(argv)`**, returning `["setsid"].concat(argv)`.
    Apply it in `startArgv`, `stopArgv`, `removeArgv`, `upgradeArgv` and
    `createArgv` (`restartArgvs` composes stop+start, so it inherits it).
    **Not `enterArgv`** — that runs through `omarchy-launch-tui` and
    `distrobox enter` needs a controlling terminal, which `setsid` removes.
    Not `listArgv`/`inspectHomesArgv`, which are never cancelled.
    → verify by tests asserting every cancellable argv starts with `setsid`
    and that `enterArgv` and `listArgv` do **not**.

2r. **`Model.js`: replace `killChildrenArgv` with `killGroupArgv(pid)`**,
    returning `["kill", "-TERM", "--", "-<pid>"]`, `null` unless the pid is a
    positive integer. The `--` and the leading `-` on the pid are what make it
    a process-group signal.
    → verify by tests, including that it is `null` for `0`/negative/non-integer
    so a stray `kill -- -0` (which would signal the caller's own group) is
    impossible.

3r. **`DistroboxState.qml`: kill the group instead of the children.**
    `killChildren(proc)` becomes `killGroup(proc)`. The ordering no longer
    matters for correctness — the group survives the parent's death — but the
    kill stays before `running = false` so the SIGTERM order is predictable.
    Comment the dependency: this is safe **only because** Quickshell does not
    `setsid` its own `Process` children, so our `setsid` does not fork and
    `processId` is the session leader.
    → verify by the runtime check below, which measures `pgid == processId`.

4r. **`docs/usage.md`:** the requirement becomes `setsid` and `kill`
    (util-linux and coreutils) rather than `pkill`.
    → verify by grep.

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
   **only** the engine to `sleep 999`, leave `distrobox` real. Enumerate the
   **whole** subtree before `K` — it is four levels, not two — and confirm
   **every** level is gone afterwards, the engine included. A real image pull
   is useless here: it finishes faster than the cancel.

1b. **The coupling holds.** Measure the spawned process: `pgid` must equal
   `processId`, proving `setsid` did not fork and the group kill targets the
   command rather than the shell. If this ever fails, prevention is unsafe and
   the lock would release early — it is the assumption the design rests on.
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

## Runtime verification: results (razer, 2026-09-24)

| Test | Result |
| --- | --- |
| 1. The whole subtree dies | **pass** — see below |
| 1b. `pgid == processId` (the assumption) | **pass** — `TOP=2098979 pgid=2098979`, distinct from the shell's `3083161` |
| 2. Nothing else dies | **pass** — shell pings `ok`, its helpers went 6 → 8, none lost |
| 3. #20 does not regress | **pass** — `mutating:false`, notice reads `starting t1 cancelled`, not "failed" |
| 5. Log clean | **pass** — 0 binding loops or TypeErrors |

Deterministic setup, engine shimmed to `sleep 999` with `distrobox` left real:

```
TOP=2098979  pgid=2098979   |  shell-pgid=3083161
subtree: 2098982 2098996 2098997          <- four levels

after K:  2098979 gone
          2098982 gone
          2098996 gone
          2098997 gone                    <- the engine
```

Under the chase implementation the engine survived; under prevention every
level dies. That is the before/after this issue exists for.

### Gotchas for anyone re-running this

- **The shim is fleet-wide.** `~/bin/podman` is position 2 on the *shell's*
  PATH, so it hits every plugin — `nixarchy-podman`'s `podman ps` was found
  sitting as a shell child mid-test.
- **It also wedges our own listing**, and `listProcess` guards on
  `if (listProcess.running) return`, so **one** hung list blocks every future
  refresh until that process dies. The box list then reads empty, `known()`
  refuses the mutation, and `s` silently does nothing. Populate the list with
  the real engine **first**, then install the shim.
- **Run the whole sequence in one ssh invocation.** The menu layer closed
  between separate invocations more than once, and `guard` then aborts.
- Clean up hung processes, not just the shim.

## Rollback

One commit per step on `fix/23-cancel-reaches-the-engine`. Reverting step 3
alone restores #20's behaviour exactly — the engine survives again, but the
lock still releases, so the plugin is never worse than it is today. `Model.js`
gains a pure function that nothing else calls, and no argv that reaches
`distrobox` changes, so there is no risk to containers from the revert or from
the change. The new `killProcess` is fire-and-forget, so a hung `pkill` cannot
hold the lock either way.
