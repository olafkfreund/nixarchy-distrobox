---
status: approved
issue: 3
author: olafkfreund
---

# Intent: GitHub Pages showcase with real captures and a user story

## Problem

nixarchy.distrobox is documented only in text: the README, `docs/usage.md`
and `AGENTS.md`. Someone deciding whether to use it cannot see it. Nothing
shows:

- what the bar glyph, the popup and the full-screen menu look like;
- what the create form, the streamed log and the confirmations look like;
- what the keyboard flow feels like, from Super+Alt+D to a shell inside a
  fresh box.

The text never makes the case for the plugin either. It does not say who it
is for, or what it replaces: a terminal full of `distrobox create` flags,
`distrobox list` with no machine-readable output, and upgrades that tie up a
terminal. It does not say why the design is what it is:

- start waits for distrobox's own setup;
- every create field is checked before distrobox's host-side `eval` sees it;
- one change runs at a time, across both surfaces.

The sibling projects already have a public face. nixarchy
(https://olafkfreund.github.io/nixarchy/) and nixarchy-podman
(https://olafkfreund.github.io/nixarchy-podman/) have Jekyll sites on GitHub
Pages. This plugin has none, although Pages is already switched on for the
repository, set to deploy through GitHub Actions from `main`.

## Proposed outcome

- **A public site.** `https://olafkfreund.github.io/nixarchy-distrobox/` looks
  like the nixarchy and nixarchy-podman sites: the same typography, layout
  and colour language. It presents the plugin to a newcomer.
- **A user story first.** The home page opens with who this is for, the
  problem it solves, and how and why it works, before any install
  instructions.
- **Real captures.** Screenshots and short screen recordings are taken from a
  live desktop. They show:
  - the bar glyph and popup;
  - the full-screen menu;
  - creating a box end to end (form → streamed log → first start → enter);
  - upgrade with detach and reattach;
  - a refused action while another runs;
  - the delete confirmation;
  - the shortcut sheet;
  - the Omarchy menu row, the key binding and the settings.
- **Setup onboarding.** A setup walkthrough covers Nix and non-Nix installs,
  enabling, the bind and the menu row, and the docker setting.
  `docs/usage.md` becomes a page on the site rather than a second copy, and
  the README links to the site.
- **Repeatable captures.** A capture script lives in the repo, as podman's
  does, so the images can be retaken when the UI changes.

## Affected users and systems

- **This repository:**
  - `docs/`: layout, styles, home page, images, recordings, capture script;
  - a Pages deploy workflow in `.github/`;
  - links in `README.md`.

  The plugin code and the flake package do not change: the package's
  explicit file list keeps all of this out of it.
- **p620's desktop,** used to take the captures:
  - it is driven with `wtype`, `grim` and `wl-screenrec` (or ai-mirror);
  - only throwaway `demo-*` boxes are used, and they are removed afterwards;
  - `shell.json` and the menu extension file are backed up and restored.

## Constraints

- **Captures show nothing but the plugin and `demo-*` boxes.** No other
  windows, notifications or personal content. They are cropped to the panel
  or menu, on an empty workspace.
- **Real captures only.** No mock-ups or edited UI.
- **Size budget.** `docs/img/` stays under 8 MB, with CI enforcing it as
  podman does, because it ships inside every `omarchy plugin add` clone.
  Videos are WebM (VP9) with an MP4 fallback, and have `controls`.
- **Styles are copied, not linked.** Styles and layout come from nixarchy's
  site, copied with source headers the way podman did, not hot-linked.
- **The captured build.** The captures show the merged v0.1.0 plugin as it is
  now.

## Open questions

1. **Scope of the site.** A home page with the user story and tour, plus the
   manual (usage.md), the same as podman? Or also a separate "Setup" page?
   Default: home, plus the manual, with setup as a section of both.
2. **Order against #1894.** Capture the Nix-installed plugin after the host
   wiring (#1894) lands, or the current hand-installed copy now? They look
   identical. Default: capture now, so the two tasks don't wait on each other.
