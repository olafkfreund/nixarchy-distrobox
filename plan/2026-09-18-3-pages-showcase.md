---
status: approved
issue: 3
spec: spec/2026-09-18-3-pages-showcase.md
---

# Plan: GitHub Pages showcase with real captures and a user story

## Approved decisions (self-contained summary)

- **The site.** Plain Jekyll in `docs/`, with no theme gem, copied from
  nixarchy-podman's site. Its stylesheet is itself a copy of
  `olafkfreund/nixarchy@e3827446bb32 docs/assets/style.css`.
  - Each copied file gets a header naming its source.
  - Pages:
    - `index.md`: the user story and the tour;
    - `usage.md`: the manual, the existing file with front matter added and
      the text kept as one copy.
  - Setup is a section of both pages, not its own page.
  - `_config.yml`: baseurl `/nixarchy-distrobox`, excludes `capture.sh`,
    and has a `nav:` over the kramdown anchors of `usage.md`.
- **The home page's story, in order:**
  1. Who it is for.
  2. The problem.
  3. What it does.
  4. How it works.
  5. Why it is built this way (the allowlists and the canary result, one
     change at a time, delete keeps homes, Cancel is the default).
  6. A tour.
  7. Set it up.
- **Captures,** real only, cropped to the surface.
  - **13 stills:** `glyph`, `popup`, `menu`, `form`, `form-advanced`,
    `form-error`, `image-list`, `log`, `busy`, `confirm-delete`, `shortcuts`,
    `omarchy-menu-row`, `settings`.
  - **3 recordings,** each ≤ 25 s: `rec-create`, `rec-start-enter`,
    `rec-menu`. Each is WebM (VP9 `-crf 40`) plus MP4 (H.264 `-crf 28`), with
    `controls muted loop playsinline`.
  - A GIF only if the budget allows.
  - `docs/img/` stays ≤ 8 MB, and CI enforces it.
- **`docs/capture.sh`:**
  - `--setup` creates `demo-fedora` (started), `demo-ubuntu` (created only)
    and `demo-broken` (`--init` on the Fedora toolbox, which fails for real).
    It refuses if any `demo-*` exists, records what it creates in
    `docs/.capture-created` (git-ignored), and backs up `shell.json` and
    `omarchy-menu.jsonc`.
  - `--teardown` removes exactly the recorded boxes and homes, and restores
    both files.
  - `--shot NAME X,Y WxH` waits for the layer, then crops with `grim`.
- **Privacy:**
  - an empty workspace, and notifications silenced with
    `omarchy-toggle-notification-silencing` (restored after);
  - every frame cropped to the panel or menu;
  - every still, and a frame sheet of every video, looked at before commit;
  - distrobox's container list and both config files diffed against a
    snapshot afterwards.
- **Outside `docs/`:**
  - `.github/workflows/pages.yml`, podman's with `main`;
  - `ci.yml` gets the 8 MB step;
  - the README links the site;
  - AGENTS.md gets "Retaking the captures".
- **Unchanged:** the plugin code and the flake package. The package's file
  list excludes `docs/`.

## Steps

Each step is one commit on `docs/3-pages-showcase`, citing `plan step N`. A
deviation updates this file in the same commit.

1. **Site skeleton.** Copy `docs/_config.yml`, `_layouts/home.html`,
   `_layouts/manual.html`, `_includes/logo.html`, `assets/style.css` and
   `assets/manual.js` from podman, adapted (names, nav, source headers). Add
   front matter to `docs/usage.md`, and a placeholder `index.md` (title plus
   one line). Add `.github/workflows/pages.yml`.
   → Verify: `nix run nixpkgs#jekyll -- build -s docs -d "$scratch/_site"`
   succeeds, and `_site/usage/index.html` exists with the nav.
2. **`docs/capture.sh`,** plus `.gitignore` for `docs/.capture-created` and
   the backups.
   → Verify: snapshot `podman ps -a` and the two config files; run `--setup`,
   then `--teardown`; the snapshots match byte for byte. Also: `--setup` run
   twice refuses the second time, and `shellcheck docs/capture.sh` is clean.
3. **Stills.** Run these in order:
   1. `--setup`.
   2. Silence notifications.
   3. Switch to an empty workspace (`hyprctl dispatch 'hl.dsp.focus({
      workspace = "31" })'`).
   4. Drive each surface with IPC plus `wtype`, and take each `--shot` once
      its layer is up.
   5. `omarchy-menu-row.png`: add the row to a *backed-up*
      `omarchy-menu.jsonc` for the shot only.
   6. `settings.png`: the widget's settings form (Super+Alt+B).

   → Verify: every PNG is looked at, with nothing outside the plugin and
   `demo-*`. `du -sb docs/img` so far.
4. **Recordings.** Record with `wl-screenrec -g "<surface geometry>"`,
   encode to WebM and MP4, and keep each ≤ 25 s.
   → Verify: an `ffmpeg … tile` frame sheet of each is looked at, and
   `docs/img` stays ≤ 8 MB.
5. **`docs/index.md`:** the user story (the seven sections above) with the
   captures and recordings, and setup (Nix, without Nix, enable, bind, menu
   row, docker setting) linking to the manual.
   → Verify: the local Jekyll build succeeds, and a link check over `_site`
   finds every internal link, anchor, image and video.
6. **Repo wiring.** The README link, AGENTS.md "Retaking the captures", and
   the `ci.yml` step for `docs/img` ≤ 8 MB.
   → Verify: `nix flake check` passes, and `nix build` still has exactly the
   12 runtime files.
7. **Teardown.** Run `capture.sh --teardown`, and turn notification
   silencing back off.
   → Verify: the distrobox container list, `shell.json` and
   `omarchy-menu.jsonc` match the step 2 snapshot. `git status` shows no
   capture leftovers.
8. **Close-out.** Fill in the implementation record, open a PR (`Closes #3`)
   that links the three artifacts, wait for CI to go green, then merge. The
   site only deploys from `main`.
   → Verify: the Pages workflow succeeds, and
   `https://olafkfreund.github.io/nixarchy-distrobox/` and `/usage/` return
   200. Load an image and a video URL from the page, and each returns 200.

## Tests

- **A. Local build:** the Jekyll build plus a link check (every `href`,
  `src` and `#anchor` in `_site` resolves).
- **B. Budget:** `du -sb docs/img` ≤ 8388608. The same check runs in CI.
- **C. Privacy review:** every still, and every recording's frame sheet, is
  looked at.
- **D. Clean desktop:** the snapshot diff after teardown.
- **E. Package unchanged:** `nix flake check`, and the file list of
  `nix build`.
- **F. Live:** the Pages deploy returns 200 on the home page, the manual and
  the media.

## Rollback

- **Before merge:** close the PR, and delete the branch.
- **After merge:** `git revert` the merge commit. The next Pages deploy
  republishes without the site, or Pages can be turned off in the repo
  settings.
- **Desktop:** `docs/capture.sh --teardown` is idempotent over its record.
  Otherwise, restore `shell.json` and `omarchy-menu.jsonc` from the backups
  `--setup` wrote, and `distrobox rm --force` the `demo-*` boxes.

## Implementation record

### Deviations

1. **Step 2: `capture.sh` keeps its record in `$XDG_RUNTIME_DIR`, not
   `docs/.capture-created`.** That is where podman's script keeps its record.
   It is outside the repository, so no `.gitignore` entry is needed and it
   cannot be committed by accident. The saved `shell.json` and menu file live
   in the same directory.
2. **Step 2: demo boxes get their own homes** under
   `~/.local/share/distrobox/demo-*`, so distrobox's first-run setup never
   writes into the owner's home. Teardown removes only recorded paths that
   match that prefix. Restores use `cp -a`, so a symlinked config file would
   come back as a symlink.
3. **Steps 3–4: what was captured instead of the planned list.**
   - **`settings.png` dropped.** The widget's settings sit inside another
     plugin (`skal.bar`), whose panel changes live bar values with the arrow
     keys, and the key guard does not cover it. The settings are a table in
     the README and the manual.
   - **`glyph.png` → `glyph-failing.png`:** the real state with a failed demo
     box (red), not a staged "idle".
   - **`omarchy-menu-row.png`** is cropped to the search field and our row.
     Unfiltered, the Apps menu lists the owner's installed applications.
   - **`rec-start-enter` → `rec-start`:** a first start (Created →
     "starting…" → running, 18 s). The Enter half opens a terminal that tiles
     across the whole monitor, outside the recorded region, and shows only a
     blank rectangle.
   - **Two plugin bugs found while recording, filed rather than fixed here**
     (this is a docs task):
     - #4: the create form shows the previous text after reopening, while its
       data is reset;
     - #5: the cursor keeps its row index when the list re-sorts, so the next
       key acts on a different box.

     The recordings show first-open and fresh-start behaviour, which is
     genuine.
   - **`demo-new`**, made through the plugin during `rec-create`, is known to
     `capture.sh` (`panel_boxes`): `--setup` refuses it and `--teardown`
     removes it.
4. **Step 7 ran before steps 5–6.** Teardown ran as soon as capture ended, to
   give the owner the desktop back. Everything after it is text.
5. **Capture safety, added during step 3.** Twice the session touched the
   owner's desktop:
   - a still caught one of the owner's windows after the owner switched
     workspaces back;
   - a keystroke may have reached the focused terminal.

   Both happened while the owner was using the machine. The leaked still was
   deleted before any commit. After that, every keystroke went through a
   guard that types only while a plugin surface (popup or menu layer) is
   on screen, and capture resumed only once the owner stepped away.

### Test results

- **Step 1:** the local Jekyll build succeeds. `/usage/` has the sidebar with
  9 section links, and the target ids exist.
- **Step 2:**
  - `shellcheck` is clean.
  - `--setup` took 28 s: `demo-fedora` running, `demo-ubuntu` created,
    `demo-broken` Exited (1) (a real "no init found").
  - A second `--setup` refused, listing every collision.
  - After `--teardown`, the container list, the distrobox homes, and both
    config files (sha256, file type, mode) are identical to the pre-setup
    snapshot, and the run directory is gone. A second `--teardown` is a
    no-op.
- **Steps 3–4:**
  - 12 stills and 3 recordings, each still and a frame sheet of each recording
    looked at, none showing anything but the plugin, `demo-*` boxes and
    wallpaper.
  - Encoded: `rec-create` 168/192 KB, `rec-start` 76/60 KB, `rec-menu`
    488/556 KB (WebM/MP4), all decoding without errors. `docs/img` is 2.50 MB
    of 8 MB.
- **Step 7 (run early):** after `--teardown`, the container list, the
  distrobox homes, `shell.json` and `omarchy-menu.jsonc` are identical to the
  pre-capture snapshot. DND is back to off, and the workspaces are back to 11
  (DP-2) and 21 (HDMI).
- **Step 5:** `docs/index.md` carries the seven-part story with the captures.
  The Jekyll build succeeds, and the link check passes (34 internal links,
  images, videos and anchors, 0 broken). Local renders of `/` and `/usage/`
  in headless Chromium match the nixarchy and podman look. The enlarged bar
  glyph uses `image-rendering: pixelated`, so the browser does not blur a 3×
  scale.
