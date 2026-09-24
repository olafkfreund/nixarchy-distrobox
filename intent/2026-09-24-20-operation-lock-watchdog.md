---
status: approved
issue: 20
author: olafkfreund
---

# Intent: a hung command must not lock the plugin forever

## Problem

The operation lock is derived from the processes themselves:

```qml
readonly property bool mutating: actionProcess.running || streaming || queue.length > 0   // DistroboxState.qml:72
readonly property bool streaming: streamProcess.running || streamQueue.length > 0          // DistroboxState.qml:85
```

That is the right shape for a command that *exits*. A failure, a non-zero exit
or a killed process all clear `running`, so the lock releases itself and cannot
be left stuck by an error path. This is deliberately not a manually-set flag,
and it should stay that way.

It has no answer for a command that never exits. There is no timeout, no
`kill()` and no watchdog anywhere in `DistroboxState.qml`: the only two `Timer`s
are the polls at `:97` and `:105`.

So when the engine wedges — a podman or docker daemon that stops responding, or
`distrobox enter -T -- true` blocking on a first-run setup that never finishes —
`mutating` stays true indefinitely. Every start, stop, restart, delete, upgrade
and create is then refused from *both* surfaces with "Busy: … wait for it to
finish", and there is no cancel affordance anywhere in the UI. The only recovery
is `omarchy-restart-shell`, which destroys the singleton and the stream log with
it.

distrobox and podman are exactly the tools that occasionally wedge — a first
image pull over a slow link, a cgroup or socket problem — so this is a plausible
real incident, and the plugin currently has no self-healing for it at all.

Reproduced by placing a `sleep 999` earlier in `PATH` under the engine name and
pressing `s` on a box: the busy banner never clears and every other action is
refused.

## Proposed outcome

- A mutation that stops making progress cannot hold the lock forever.
- The user can tell the difference between "still working" and "wedged", and can
  get back to a usable plugin without restarting the shell.
- The lock stays *derived*. Whatever is added must not reintroduce a manually
  managed flag that an error path can leave set.
- A long but healthy operation — a large image pull, `upgrade all` across many
  boxes — is not killed for being slow.

## Affected users and systems

Anyone running the plugin on a nixarchy desktop, from either surface. Touches
`DistroboxState.qml` (the singleton, shared by the bar popup and the menu) and
whatever surface change is needed to expose the state or the escape hatch.
No change to `Model.js` argv building is expected.

## Constraints

- Must not weaken "one mutation at a time, via the singleton".
- Must not kill a healthy long-running operation. Wall-clock alone is a poor
  signal: `create` and `upgrade` legitimately run for minutes. Progress on the
  stream is a better one, but `actionProcess` (start/stop/restart/delete) has no
  stream to watch, so the two paths may need different treatment.
- Killing a half-finished `distrobox create` leaves a partial container. Whatever
  is done must not leave the box list lying about what exists.
- External commands are run by name from `PATH` and never wrapped, so a timeout
  cannot be imposed by wrapping the command in `timeout(1)`.
- Argv arrays only; no `sh -c`.
- Any new logic belongs in `Model.js` with a Node test, not in QML.

## Open questions

1. **Timeout, cancel, or both?** A watchdog needs no user action but has to guess
   a safe duration. An explicit cancel key never guesses wrong but needs the user
   to notice they are stuck. Which does the owner want, and if both, does cancel
   ship first as the smaller change?
2. **What counts as progress?** For a streaming operation, "no output for N
   seconds" is available and meaningful. For `actionProcess` there is no output
   at all, so the only signals are wall-clock or engine liveness. Is a plain
   generous wall-clock cap acceptable there?
3. **What does the escape hatch do to the container?** Kill the process only, or
   also attempt cleanup of a partial `create`? Cleanup is more correct and more
   dangerous.
4. **Is a stuck lock worth surfacing in the bar glyph**, so the user sees it
   without opening a surface?
