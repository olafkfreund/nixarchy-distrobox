---
status: draft
issue: 20
intent: intent/2026-09-24-20-operation-lock-watchdog.md
---

# Spec: a hung command must not lock the plugin forever

## Design

### The shape of the fix: cancel, not a timeout

The intent asked whether this should be a watchdog, an explicit cancel, or both.
**Cancel only.** A watchdog has to guess how long an operation is allowed to
take, and every guess is wrong somewhere: a first `podman pull` over a slow link
legitimately runs for many minutes, and `upgrade all` across a dozen boxes runs
for longer. Killing one of those because a constant expired turns a working
plugin into a broken one, which is a worse failure than the one being fixed.

Cancel never guesses. It also fully solves the stated problem — "the only
recovery is restarting the shell" — because the user gets the lock back on
demand.

What cancel needs is *discoverability*, since the user has to know it exists.
That comes free: the refusal message already names the key to press. It becomes

```
Busy: upgrade t1 — press o to watch, X to cancel
```

so the affordance is in front of anyone who hits the lock, at the moment they
hit it. No new UI surface, no timer, no constant to tune.

### How the process is stopped

`Quickshell.Io.Process` exposes no `kill()` or `signal()` method. It has a
settable `running` property (setting it false sends SIGTERM) and a read-only
`processId`. So:

1. `running = false` on whichever process holds the lock.
2. `exited` fires, `running` goes false, and because `mutating` and `streaming`
   are *derived* (`DistroboxState.qml:72,85`), the lock releases itself through
   the path that already exists. **No new state, no flag to leave stuck** — this
   is the property the intent required be preserved.
3. The existing `onExited` handlers run. They already clear the busy notice,
   reset `pendingVerb`/`pendingName`, and refresh, so a cancel lands the plugin
   in a consistent state without new cleanup code.

A cancel must also drop `queue` and `streamQueue`, or `onExited` will start the
next command in a multi-box `restart` or `upgrade all` and the lock will never
release. That is the one genuinely new line of control flow.

### Which process, and what it is called

`Model.js` gains one pure function with a Node test, per the repository rule:

```js
// What a cancel should do right now, or null when nothing is cancellable.
function cancelTarget(mutating, streaming, streamTitle, pendingVerb, pendingName)
//   -> { process: "stream" | "action", label: "upgrade t1" } | null
```

The QML reads `target.process` to pick `streamProcess` or `actionProcess`, and
`target.label` for the log line and the error text. `busyText()` gains the
`, X to cancel` suffix. Both are tested from Node.

### Key binding

`X` in list mode and log mode, handled in `handleTextKey` and `LogView`'s key
handler. It is free: list mode currently takes `? / u S U o c e s r y p g` plus
the `PanelKeyCatcher` built-ins (`j k` arrows, Enter, Space, `x`, Esc).

`X` sits next to `x` (delete box), but a mis-shift is safe in the dangerous
direction: `x` opens a confirmation rather than deleting, and `X` when nothing is
running does nothing.

Cancel itself is **not** confirmed. A confirmation on the escape hatch from a
wedged lock defeats the purpose, and the action is already deliberate — the user
had to read the refusal to learn the key.

### What is deliberately not done

Nothing tries to clean up a partially created container. `distrobox create`
leaves a partial box behind when interrupted, and the box list already tells the
truth about that on the next refresh — the user can delete it with `x`. Automatic
cleanup means issuing a `rm` against a box the user did not ask to remove, which
is a worse failure mode than an obvious leftover.

The log records the cancel (`── cancelled`) so a partial create is not silent.

## Alternatives rejected

- **Wall-clock timeout.** Guesses a duration that is wrong for a slow pull or a
  large `upgrade all`, and kills healthy work. Rejected as a fix that introduces
  its own incident.
- **Idle-output watchdog on the stream** ("no output for N seconds"). Better
  signal than wall-clock, and genuinely tempting for `create`/`upgrade` — but
  `actionProcess` (start/stop/restart/delete) produces no output at all, so it
  covers only half the problem and the other half still needs cancel. Once cancel
  exists, this adds a tunable constant for no additional recovery. Rejected as
  redundant, and reconsidered only if cancel proves insufficient in practice.
- **`timeout(1)` wrapping the command.** Forbidden: AGENTS.md requires external
  commands be run by name from `PATH`, never wrapped.
- **A manual `cancelled` flag on the state.** Reintroduces exactly the
  stuck-flag failure the derived lock was designed to avoid. Rejected.
- **`kill -9` by `processId`.** Reserved as an escalation, not the default:
  SIGTERM lets `distrobox` and the engine unwind. See Risks.
- **Restart-the-shell as documented recovery.** Destroys the singleton and the
  stream log; it is the status quo this issue exists to remove.

## Risks

- **SIGTERM may not reach the child doing the work.** `running = false` signals
  the `env` / `distrobox` process; the `podman` or `docker` child performing a
  pull may survive and keep running detached. The lock still releases (which is
  the user-visible fix), but the machine may keep pulling. This is the main
  limitation and must be verified on hardware, not assumed. If it proves real,
  the escalation is a second `Process` running `kill` against the process group
  via `processId` — deliberately out of scope here.
- **A cancelled `create` leaves a partial box.** Accepted and logged, not
  cleaned up. Named in the docs.
- **Cancelling mid-`upgrade all`** leaves some boxes upgraded and some not. The
  existing summary path reports per-box results, so this is visible rather than
  silent.
- **A wedged process that ignores SIGTERM** will not die, so `running` stays
  true and the lock stays held. Cancel is then no better than today. Verifying
  this against a real wedge (not `sleep 999`, which does honour SIGTERM) is part
  of verification.
- Host: nixarchy desktops only. No change to any command's argv, so no change to
  the host-quoting surface.

## Verification

1. `node tests/run.js` — new `cancelTarget` tests pass, existing 99 stay green.
2. `nix flake check` and `nix flake check --all-systems --no-build`.
3. `nix build` and `omarchy plugin validate` on a fresh clone.
4. **Runtime, the actual bug:** put a `sleep 999` earlier in `PATH` under the
   engine name, press `s` on a box, confirm the refusal reads
   `… X to cancel`, press `X`, and confirm the lock releases and a normal
   `s` works again — without restarting the shell.
5. **Runtime, the SIGTERM risk:** cancel a real `create` mid-pull, then check
   with `ps` whether the engine child is still running. Record the answer in the
   plan; it decides whether the escalation is needed.
6. **Runtime, the queue:** cancel during `upgrade all` with three boxes and
   confirm the remaining boxes are *not* started and the lock releases.
7. Both surfaces: confirm cancel works from the bar popup and the menu, and that
   the singleton is genuinely shared (cancel in one, lock free in the other).
8. `docs/usage.md` and `README.md` updated in the same PR, per the repo rule.
