---
status: draft
issue: 1
author: olafkfreund
---

# Intent: Keyboard-driven Distrobox plugin for Omarchy (bar widget and menu)

## Problem

Distrobox boxes on nixarchy can only be managed from a terminal:
`distrobox list`, `enter`, `stop`, `upgrade`, `rm`. That leaves these gaps
next to our other Omarchy plugins (nixarchy-podman, nixarchy-pkg,
nixarchy-ghtui):

- **Nothing on the desktop shows box state.** You cannot tell whether a box is
  running without opening a terminal. `distrobox list` has no machine-readable
  output, so nothing in the shell can show that state today.
- **Creating a box means remembering flags.** `distrobox create` has more than
  20 options (image, home, init, nvidia, volumes, hooks, unshare-*, and so on).
  Short image names fail on this host, because Podman has no unqualified-search
  registries.
- **Long operations tie up a terminal.** Creating a box pulls an image, and an
  upgrade runs the package manager inside every box. Both take minutes and give
  no feedback anywhere else.
- **Not keyboard-first, not themed.** No existing tool follows the Omarchy
  theme or the keyboard model the sibling plugins share.

## Proposed outcome

- A plugin with id `nixarchy.distrobox` that has the same two surfaces as
  nixarchy.podman:
  - a bar glyph showing running/total boxes, with a keyboard popup;
  - a full-screen keyboard menu, opened by
    `omarchy-shell shell toggle nixarchy.distrobox '{}'`, an Omarchy menu row,
    and a suggested `SUPER + ALT + D` bind.
- One list of the real distrobox containers (label `manager=distrobox`).
  From it you can enter a box (in a terminal), start, stop, restart, upgrade,
  delete, upgrade all, stop all, and copy a name, all from the keyboard.
- A keyboard-navigable create form that exposes every `distrobox create` flag
  except `--root`. The common fields are shown first; the rest sit in a
  collapsed Advanced section. Bad input shows an inline error before anything
  runs.
- Create and upgrade stream their output into a log inside the panel. Esc
  hides the log while the job keeps running. `o` brings it back.
- It looks like the sibling plugins and follows theme switches: `Color.*` and
  `Style.*` only.
- It is packaged as a flake with the same checks as nixarchy-podman, plus
  `docs/usage.md`, a README and `AGENTS.md`.

## Affected users and systems

- This new repository, `github.com/olafkfreund/nixarchy-distrobox`.
- nixarchy hosts that add it (p620 and razer) through the host flake and
  `programs.nixarchy.plugins."nixarchy.distrobox".src`. That wiring is a
  separate change, made after this one merges.
- Runtime requirements, all on `PATH`:
  - `distrobox`;
  - `podman` or `docker`;
  - `omarchy-launch-tui` and `wl-copy`, which Omarchy provides.
- The fedora/ubuntu/debian boxes declared in Home Manager are **not** read.
  They appear in the list once they have been created.

## Constraints

- Follow the nixarchy-podman rules:
  - no symlinks anywhere in the repository;
  - `Color.*` and `Style.*` only, never a hex colour;
  - no pacman or yay, not even in comments;
  - every runtime file listed in the flake;
  - external tools called by name from `PATH`;
  - logic in `Model.js` with Node tests;
  - no polling while the surfaces are closed;
  - reset state when the keepLoaded plugin opens;
  - docs updated in the same PR.
- **Never hand user input to a shell.** Commands are argv arrays. distrobox
  itself `eval`s the generated create command on the host, so every form field
  is checked against an allowlist that suits where it lands in that command.
- Every distrobox call uses the engine chosen in settings
  (`DBX_CONTAINER_MANAGER`), so a docker user never acts on a podman box.
- One mutating operation at a time, shared by the bar and the menu.
- Package with `runCommand` and real file copies, using only the nixpkgs
  input, with no Home Manager or NixOS module of its own. It must pass
  `omarchy-plugin-validate`.

## Open questions

1. **Engine:** a `containerManager` setting with the values `podman` (default)
   or `docker`, and no auto-detect. Agreed?
2. **`--root` boxes:** left out of v1, because they need sudo without a TTY.
   Agreed?
3. **Delete:** keeps the box's home directory (no `--rm-home`), and the confirm
   dialog says so. Should `--rm-home` be a follow-up?
4. **Enter key:** Enter opens the box in a terminal and `s` starts or stops it.
   This deliberately differs from podman, where Enter starts and stops.
   Agreed?
5. **Streams across a shell restart:** a create or upgrade that is still
   running dies when the shell restarts. v1 documents this rather than
   detaching the process. Acceptable?
