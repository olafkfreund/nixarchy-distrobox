---
status: draft
issue: 17
author: olafkfreund
---

# Intent: Full feature tour recording for the README, the Pages site and nixarchy's site

## Problem

The showcase from #3 was captured before three features landed:

- **built-in templates** (#7);
- **your own templates** from a `distrobox assemble` file (#8);
- **promote** (`p`, #14).

None of the three appears on the site or in the README. The README has no
video at all: someone reading it on GitHub sees text and tables only. The
site's three recordings each show one slice (create, start, the menu), and
none shows the whole flow in one go.

nixarchy's own site (https://olafkfreund.github.io/nixarchy/) is where most
users meet the ecosystem. It does not show this plugin.

A full live run on razer (2026-09-21) exercised every surface and feature and
recorded a scripted tour. That run also found bugs, some of which are visible
in the new captures:

- the promote snippet's footer says "following";
- the snippet says "podman" on docker;
- the list footer stays on screen in form and snippet modes.

## Proposed outcome

- **README:** opens with a short tour video (WebM with an MP4 fallback, or a
  linked poster frame where GitHub will not play inline video), right under
  the one-line description.
- **The Pages home page:**
  - gains the tour as its lead recording;
  - gains stills for **your templates** and **promote**, each with a
    sentence on what it does.
- **The manual** (`docs/usage.md`) links the new stills from its templates
  and promote sections.
- **nixarchy's site** gets a short entry for the plugin: one still or the
  tour, a line on what it is, and a link. That change is made in the
  nixarchy repository, under its own workflow.
- **Captures stay repeatable.** The tour script used on razer is committed
  next to `docs/capture.sh`, so the video can be retaken whenever the UI
  changes.

## Affected users and systems

- **This repository:**
  - `README.md`, `docs/index.md` and `docs/usage.md`;
  - `docs/img/`, with new files `rec-tour.{webm,mp4}`, `promote.png` and
    `templates.png`;
  - `docs/` for the tour script.

  The plugin code and the flake package do not change: the package's
  explicit `files` list keeps all of this out of it.
- **olafkfreund/nixarchy:** its `docs/` site, as a separate change there.
- **razer's desktop**, if the captures are retaken:
  - only `demo-*` boxes are used;
  - `shell.json`, the menu extension file and do-not-disturb are restored;
  - the box list is diffed against a before-snapshot, as in this run.

## Constraints

- Real captures only, and never of anything but the plugin, `demo-*` boxes
  and the wallpaper. For this run the owner allowed their generic `Fedora` and
  `Debian` boxes to appear in the list.
- `docs/img/` must stay under 8 MB (CI enforces it). The tour takes it from
  2.6 MB to about 6.1 MB.
- The tour speeds up the ~45 s first-start wait 8×. That must be said on the
  page, so nothing implies the setup is instant.
- No symlinks. No hardcoded colours in any styling.

## Open questions

1. **Fix first, or publish now?** Some bugs from this run are visible in the
   new captures (promote footer, "podman" on docker). Should they be fixed
   first and the tour retaken, or should the current captures be published
   now and retaken later? Default: publish now; the fixes retake them.
2. **README video.** GitHub renders a `<video>` only for user-attachments
   URLs, not for files in the repo. Should the README link a poster frame to
   the site's video, or use an uploaded attachment? Default: a poster frame
   linking to the site.
3. **Scope on nixarchy's site.** Should it get a card or a section, and on
   which page? Default: a short section on its plugins page, owned by a
   nixarchy issue.
