---
status: approved
issue: 23
intent: intent/2026-09-24-23-cancel-reaches-the-engine.md
---

# Spec: a cancel stops the work, not just the command

## Design

**REVISED 2026-09-24, after measurement: prevent, not chase.** The original
decision was chase, on my recommendation, and it was wrong.

Chase was recommended partly on the grounds that the tree is shallow
(`distrobox create` → `podman pull`). This spec required verification to
"actually inspect the tree rather than assume two levels". It did, and the
assumption was false. `distrobox` is a chain of bash scripts, so the real
tree is **four levels**:

```
1857850  bash (distrobox)   <- SIGTERM from running = false
  1857853  bash             <- pkill -P reaches only this
    1857872  bash
      1857873  the engine   <- SURVIVES
```

`pkill -P` is one level, so the engine survives exactly as before: the chase
fix **does not fix the bug at all**, and is not even a partial improvement.

There is no rescue inside the chase design. Every level was measured and
**all four share the shell's `pgid=3083161`**, so no group or session anchor
exists anywhere to kill against; any group kill would hit the shell.

Prevention was measured on a deliberately four-deep tree and works:

| Check | Result |
| --- | --- |
| `setsid` top-level pgid | **1860502**, distinct from the invoking shell's **1860499** |
| `kill -TERM -<pgid>` | the nested process died, 1 → 0 |

One prefix at spawn, one kill at cancel, correct at any depth, and it cannot
hit the shell because the pgid is genuinely separate.

**The coupling risk that made me reject prevention is real but is the lesser
evil.** If Quickshell ever starts `setsid`-ing its own `Process` children,
our `setsid` would fork, `processId` would become a wrapper that exits at
once, and the lock would release while work continues. That is a *future,
conditional* failure; chase is a *present, unconditional* one. A fix that
does not work is worse than a fix with a documented dependency, and the
dependency is checkable on hardware (`pgid == processId`).

**Scope:** the prefix goes on the cancellable mutations only —
`start`, `stop`, `remove`, `restart`, `upgrade`, `create`. **Not `enter`**:
`enterArgv` runs through `omarchy-launch-tui`, and `distrobox enter` needs a
controlling terminal, which `setsid` would take away. Not listing or
inspect, which are never cancelled.

### Why not prevention, recorded so it is not revisited by accident

Spawning each mutation under a `setsid` prefix would make
`kill -- -<processId>` safe and reduce the fix to one line. It works **today**,
and both halves were measured rather than assumed:

- Quickshell does **not** isolate `Process` children: on razer the shell
  (pid 1722597) and all six of its children share `pgid=3083161`.
- Because those children are therefore not process-group leaders, `setsid`
  does **not** fork — verified directly: the tracked pid and the exec'd
  program's pid were identical. So `processId` would be the session leader.

That is exactly the problem. The correctness of the lock would rest on
Quickshell continuing not to `setsid` its children — an upstream detail, and
`setsid` is already imported by the quickshell binary. If that ever changes,
our `setsid` starts forking, `processId` becomes a throwaway wrapper that
exits immediately, `running` goes false, and **the lock releases while the
work continues** — the precise failure #20 exists to prevent, reintroduced
silently, with no test of ours going red.

Prevention also touches `start`, `stop`, `rm` and `restart`, which have no
such problem, and a `setsid` prefix is process-control plumbing rather than
the correctness requirement that earns `env DBX_CONTAINER_MANAGER=` its
exemption from "never wrap a command".

### The change

`Model.js` gains one pure, tested function:

```js
// The children of a process we are about to SIGTERM. By PID, never by
// pattern: AGENTS.md records that `pkill -f <pattern>` also kills the shell
// issuing it, because that shell's command line contains the pattern.
function killChildrenArgv(pid)   // -> ["pkill", "-P", "<pid>"] or null
```

It returns `null` unless `pid` is a positive integer, so a missing or
not-yet-assigned `processId` cannot produce an argv.

`DistroboxState` gains a fire-and-forget `Process { id: killProcess }`,
mirroring the existing `copyProcess`, and `cancel()` runs it **before**
setting `running = false`.

### The ordering is the whole correctness argument

`pkill -P` selects by parent PID. Once the parent is dead its children are
reparented to init, and the `-P` link is gone. So:

1. `Model.killChildrenArgv(proc.processId)` → run it. The engine dies while
   `distrobox` is still its parent.
2. *Then* `running = false`, which SIGTERMs `distrobox` itself.

Reversing these leaves the pull running and looks like it works, because the
lock still releases. This mirrors #20's "clear the queues first": both are
orderings whose violation is silent.

### What is deliberately not done

- **No SIGKILL escalation.** It needs a timer, and #20 has none by design. If
  an engine ignores SIGTERM the lock still releases, so the user is no worse
  off than today.
- **No change to the notice or the log.** A cancelled `create` can still leave
  a partial box, which #20 documented. Claiming more cleanup than happens is
  the thing this issue is about.
- **No cleanup of partial images or containers.** #20 decided that; this does
  not reverse it.
- **`upgrade all` needs nothing extra** (intent question 4). The queue is
  already cleared by `cancel()`, and the running box's descendants are killed
  by the same path as any other stream.

### The honest ceiling

`pkill -P` is **one level**. It covers the measured tree — `distrobox create`
→ `podman pull` — and `distrobox enter` → engine. A deeper tree would need
iteration. This is stated in the spec, in the plan, and in a comment at the
call site, because a reader who believes it is recursive will be wrong.

## Alternatives rejected

- **Prevention via a `setsid` prefix.** See above: couples the lock's
  correctness to an upstream implementation detail whose change would fail
  silently.
- **`kill -- -<processId>` as-is.** Measured to be catastrophic here: every
  `Process` child shares the shell's pgid, so this signals the shell's own
  group and takes down the shell and every other plugin's helpers.
- **`pkill -f <pattern>`.** Forbidden by AGENTS.md, which records it killing
  the shell that issues it.
- **Recursive descent through `/proc/<pid>/task/*/children`.** More thorough
  and more code, and it needs a reader in QML. Worth doing only if a real
  tree proves deeper than one level; `pkill -P` is the smaller thing that
  covers the measured case.
- **A timer that escalates to SIGKILL.** Deferred with the same reasoning
  #20 used for a watchdog: it guesses a duration, and the lock already
  releases without it.

## Risks

- **The engine may ignore SIGTERM**, leaving a pull running. Then the change
  achieves nothing for that case, but nothing regresses either.
- **A deeper process tree escapes**, per the ceiling above. Verification must
  actually inspect the tree rather than assume two levels.
- **`pkill` must exist.** It is at `/run/current-system/sw/bin/pkill` on this
  host, but a missing command fails silently inside a QML `Process`, so it is
  documented as a requirement like every other external command.
- **`processId` could be 0 or unset** if `cancel()` is somehow reached before
  the process starts. `killChildrenArgv` returns `null` and the kill is
  skipped; the SIGTERM still happens.
- **Regression risk to #20 is the real one.** The lock must still release
  immediately, and must not wait on `killProcess`. The kill is
  fire-and-forget precisely so a hung `pkill` cannot hold anything.

## Verification

1. `node tests/run.js` — new `killChildrenArgv` rows, existing 101 green.
2. `nix flake check`, `--all-systems --no-build`, `nix build`,
   `omarchy plugin validate` on a fresh clone. The `no-text-multiplier` check
   from #22 must still pass.
3. **The measured failure is fixed.** Reuse #20's deterministic setup — shim
   **only** the engine to `sleep 999`, leave `distrobox` real — so the tree is
   `shell → distrobox (real) → engine (hangs)`. Record both PIDs, press `K`,
   and confirm **both** are gone. Under #20 the grandchild survived; that is
   the before/after.
4. **The ordering matters.** Confirm by reading the code that the kill runs
   before `running = false`, and note in the plan that reversing it still
   passes a naive "lock released" check.
5. **#20 does not regress**: the lock still releases immediately, a fresh
   mutation is accepted, and cancelling mid-`upgrade all` still leaves the
   queue stopped.
6. **Nothing else dies.** After a cancel, confirm the shell is still up and
   its other `Process` children (`inotifywait`, `wl-paste`, `gdbus`) are
   still running — the specific catastrophe a process-group kill would cause.
7. `docs/usage.md` — the troubleshooting entry says a cancel does not tidy up;
   check it is still accurate and say that the engine is now stopped too.
