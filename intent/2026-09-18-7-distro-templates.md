---
status: draft
issue: 7
author: olafkfreund
---

# Intent: distro templates, a "Start from" list in the create form

## Problem

The create form's image picker (`Model.IMAGES`, 13 fully qualified images) fills in
the **image** and nothing else. Whatever differs from one distro to another is
left for the user to know, and one of those differences fails without warning.

- **Init needs systemd in the image, and the toolbox images do not ship it.**
  - A box created with **Init** on (`--init`) fails its first start with
    "no init found".
  - This was hit live while recording the showcase (#3): `demo-broken` is exactly
    that box, and the Init row's hint (`Model.js:882`) only warns about it.
  - The fix is extra packages, and their names differ per distro: Fedora
    `systemd`; Debian and Ubuntu `systemd libpam-systemd dbus`; Arch `systemd`.
- **Package names and a sensible home differ too.** Every user has to work them
  out again for each distro.
- **"The image exists" is all the list claims today.** Nothing says an image has
  been created, started and entered on nixarchy.

## Proposed outcome

- A **"Start from"** field at the top of the create form, driven from the keyboard
  exactly like the image list: ↓ opens it, Enter picks, typing filters. No
  Popup: a Popup ignores the menu's 1.45× scale, as the original design found.
- **Picking a template pre-fills the form:**
  - the image;
  - extra packages, including the init packages when Init is on;
  - a suggested home under `~/.local/share/distrobox/<name>`.

  Every field stays editable.
- **The first entry is Blank:** today's behaviour, so any image still works and
  nothing is taken away.
- **Built-in templates** for at least Fedora, Ubuntu, Debian and Arch, as a table
  in `Model.js` with Node tests.
- A **"tested on nixarchy"** mark only on templates that have been created,
  started with Init, and entered live. Nothing is claimed that has not been
  seen.

## Affected users and systems

- **This repository:**
  - `Model.js` (the template table, and how a template is applied to a form);
  - `CreateForm.qml` (the field and its inline list);
  - tests, docs (usage.md and the README keys and form sections), and the
    showcase if its form stills go out of date.
- **Everyone using the plugin** on p620 and razer, through the Nix input.

## Constraints

- **The AGENTS.md rules:** logic in `Model.js` with Node tests; QML only wires
  it; no hardcoded colours.
- **Every value a template fills** goes through the existing per-field
  allowlists in `validateForm`, because distrobox evaluates the create command on
  the host. A template never bypasses validation.
- **Builds on #4:** the form's fields must bind to its data, so a template's
  values show up in them. #4 and #5 are merged first.
- **Phase 2,** templates of the user's own from a `distrobox assemble` `.ini`, is
  a separate task (#8). This one leaves room for it without building it.

## Open questions

1. **The built-in set:** Fedora, Ubuntu 24.04, Debian 12 and Arch, or also
   openSUSE, Rocky, Alma and Alpine? Default: the first four, each tested live;
   more later as they are tested.
2. **Picking a template after typing:** overwrite only the fields the template
   sets, and leave the name? Default: yes, overwrite image, packages and home;
   never touch the name.
3. **Should a template switch Init on?** Default: no. Init stays the user's
   choice, and the template only adds the init packages when Init is on.
