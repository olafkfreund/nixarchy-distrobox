---
status: draft
issue: 8
author: olafkfreund
---

# Intent: templates of your own, from a distrobox assemble file

## Problem

After #7, the create form offers built-in templates. But the boxes a person
actually wants are their own: the owner's Home Manager config already defines
standard fedora, ubuntu and debian boxes (image, own home) as wrapper scripts
that create them on first run. The plugin cannot see those definitions, so
the same setup has to be retyped in the form, or the wrappers used from a
terminal.

distrobox already has a file format for exactly this: **`distrobox assemble`**.
It is an `.ini` file with one section per box, whose keys (in 1.8.2.5) cover:

- the create flags: `image`, `home`, `additional_packages`, `additional_flags`,
  `init`, `init_hooks`, `pre_init_hooks`, `nvidia`, `pull`, `root`, `volume`,
  `hostname`, `clone`, `entry`, and the `unshare_*` flags;
- `include` (a section inheriting another);
- `start_now` and `replace`;
- `exported_apps`, `exported_bins` and `exported_bins_path`.

A file in this format is useful with or without the plugin: `distrobox assemble
create --file …` works from any terminal.

## Proposed outcome

- **The plugin reads a user template file** (default
  `~/.config/distrobox/boxes.ini`, changeable in settings). Each section appears
  in #7's "Start from" list under **Yours**, next to the built-ins.
- **Picking one fills the form,** exactly like a built-in, so the user sees and
  can edit what will run. Values the form does not model (`include` resolved,
  `exported_*`, `start_now`) are shown and handled as the spec decides.
- **A section that cannot be used safely** stays in the list, marked, with the
  reason, and cannot be created.
- **A follow-up in nixos_config** (its own change, not this repository): Home
  Manager writes `boxes.ini` from the same definitions as the fedora, ubuntu and
  debian wrappers, so one Nix definition serves the wrappers, the plugin and
  `distrobox assemble`.

## Affected users and systems

- **This repository:** `Model.js` (an `.ini` parser, section resolution including
  `include`, and section-to-form mapping), `DistroboxState.qml` (reading the file),
  `CreateForm.qml` (the "Yours" group), settings, tests and docs.
- **The owner's `~/.config/distrobox/`.** Read only: the plugin never writes the
  file.

## Constraints

- **Security is the hard part.**
  - `assemble` builds a command and runs it through its own `eval`
    (`distrobox-assemble:474`), and `create` evaluates again.
  - Every value read from the file therefore goes through the **same per-field
    allowlists** as the form (`validateForm`), with Node tests on hostile `.ini`
    samples.
  - The `exported_*` keys run exports inside the box, and need their own
    rules or must be refused.
  - A file is data, never trusted code.
- **Keep the plugin's own `createArgv` path.** Filling the form, then creating
  through `createArgv`, keeps one validated route to `distrobox create`. Calling
  `distrobox assemble` directly is an alternative for the spec to weigh.
- **Parsing lives in `Model.js`,** with Node tests: sections, keys, `include`,
  repeated keys (such as `volume`), comments, and malformed lines.
- **Depends on #7,** which provides the "Start from" list.

## Open questions

1. **The file location:** a fixed `~/.config/distrobox/boxes.ini`, or a setting?
   Default: a setting, defaulting to that path.
2. **The `exported_apps` and `exported_bins` keys:** refuse them in v1 (show them,
   but do not create), or support them? Default: refuse in v1. They add a
   second command path inside the box, and each needs its own allowlist.
3. **Create through the form** (fill, then `createArgv`) **or run `distrobox
   assemble create` directly?** Default: through the form, one validated path,
   and the user sees exactly what runs.
