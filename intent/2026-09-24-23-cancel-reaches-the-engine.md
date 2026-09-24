---
status: approved
issue: 23
author: olafkfreund
---

# Intent: a cancel should stop the work, not just the command

## Problem

#20 added `K`, which cancels a running operation and gives the panel back.
That part works: the lock releases and the next mutation is accepted without
restarting the shell.

It stops the wrong amount of work. `Quickshell.Io.Process` exposes no
`kill()`, so `cancel()` sets `running = false`, which sends SIGTERM to the one
process the plugin spawned. `distrobox create` is a shell script that spawns
the engine; the engine is a *grandchild*, and SIGTERM never reaches it.

Measured during #20's verification, made deterministic by shimming only
`podman` and leaving `distrobox` real:

```
DIRECT CHILD 1221103 (distrobox create): GONE     <- SIGTERM killed it
GRANDCHILD   1221127 (podman)          : SURVIVED
```

So on a slow first pull, `K` returns the panel while several hundred megabytes
keep downloading with nothing on screen to say so, no way to stop it from the
plugin, and a later `distrobox list` that may disagree with what the engine is
doing. The user is told the operation was cancelled, and it was not.

## Proposed outcome

- Cancelling stops the work, not only the command that started it.
- What a cancel does and does not clean up is honest: the notice and the log
  should not claim more than happened.
- The lock still releases immediately, whatever the descendants do. #20's
  promise must not regress into "cancel hangs until the engine notices".
- Nothing else on the desktop is affected.

## Affected users and systems

Anyone who cancels a `create` or `upgrade` on a slow network. Touches
`DistroboxState.cancel()` and whatever `Model.js` needs to build the argv for
stopping the descendants; `Model.js` keeps owning argv construction.

## Constraints

- **The obvious fix is dangerous and must not be used as-is.** Killing the
  process group would be the natural approach, but **Quickshell does not put
  spawned children in their own process group.** Measured on razer: the shell
  (pid 1722597) and every one of its `Process` children — `inotifywait`,
  `gdbus`, `voxtype`, both `wl-paste` — all share `pgid=3083161`. So
  `kill -- -<processId>` would signal the shell's own group and take down the
  shell and every other plugin's helpers. (`setsid` is imported by the
  quickshell binary, but evidently not for `Process` children.)
- AGENTS.md: external commands are run **by name from `PATH`**, never wrapped
  or bundled; **argv arrays only, never `sh -c`**; a missing command fails
  silently inside a QML `Process`, so any new dependency is documented as a
  requirement.
- AGENTS.md also records that `pkill -f <pattern>` kills the shell issuing it,
  because that shell's command line contains the pattern. Any process
  selection must be by PID, never by pattern.
- The lock must stay **derived**. #20 deliberately has no lock state that can
  be left stuck, and that must survive.
- Killing an engine mid-pull can leave a partial image or a partial container.
  #20 already decided not to clean those up automatically; that decision
  should not be quietly reversed here.
- `setsid` and `pkill` are both present on this host, and `/proc/<pid>/task/*/children`
  is readable — so more than one approach is available.

## Open questions

1. **Prevent or chase?** Either spawn each mutation so it is already isolated
   (a `setsid` prefix, the same shape as the existing
   `env DBX_CONTAINER_MANAGER=…` prefix, making a later group kill safe), or
   leave spawning alone and walk the descendants at cancel time. Prevention is
   cleaner and makes the kill a one-liner; chasing avoids changing how every
   command is started. Which does the owner prefer?
2. **How hard should it kill?** SIGTERM to the tree and accept that a wedged
   engine ignores it, or escalate to SIGKILL after a grace period? An
   escalation needs a timer, which #20 deliberately avoided.
3. **Does this change what the user is told?** If a cancel now stops the pull,
   the notice could say so. If some descendants may still survive, it should
   not overclaim.
4. **Is `upgrade all` different?** It runs a queue; a cancel mid-queue already
   stops the rest. Does stopping descendants change anything there, or is it
   the same path?
