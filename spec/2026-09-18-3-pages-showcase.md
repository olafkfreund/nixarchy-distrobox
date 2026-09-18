---
status: approved
issue: 3
intent: intent/2026-09-18-3-pages-showcase.md
---

# Spec: GitHub Pages showcase with real captures and a user story

## Decisions taken from the intent's open questions

The owner approved the intent with its defaults:

1. **Site scope:** a home page (the user story and a tour) plus the manual
   (`docs/usage.md`), the same as nixarchy-podman. Setup is a section of both
   pages, not a page of its own.
2. **Timing:** captures are taken now, from the installed v0.1.0 plugin. They
   do not wait for the host wiring (nixos_config#1894); the plugin looks the
   same either way.

## Facts checked for this spec

- **The model to follow.** nixarchy-podman's site
  (https://olafkfreund.github.io/nixarchy-podman/) is plain Jekyll with no
  theme gem and about 780 lines in total:
  - `docs/_config.yml` (27 lines);
  - `_layouts/home.html` and `_layouts/manual.html`;
  - `_includes/logo.html`;
  - `assets/style.css` (258 lines) and `assets/manual.js`;
  - `index.md`, and `capture.sh` (129 lines);
  - `.github/workflows/pages.yml` (40 lines).
- **The styles.** Its stylesheet is copied from
  `olafkfreund/nixarchy@e3827446bb32 docs/assets/style.css`, with a header
  naming the source. That copy is where the shared look comes from.
- **The home page.** podman's `index.md` has seven sections, in order: Who it
  is for → The problem → What it does → How it works → Why it is built this
  way → A tour → Install.
- **This repository.** Pages is on here, deploying through GitHub Actions
  from `main` (`build_type: workflow`).
- **Tools.** `wl-screenrec`, `ffmpeg`, `grim` and `wtype` are installed on
  p620.
- **Local images.** `registry.fedoraproject.org/fedora-toolbox:latest` and
  `quay.io/toolbx/ubuntu-toolbox:24.04` are already pulled on p620, so demo
  boxes need no multi-GB pulls. The distrobox containers themselves have been
  removed.

## Design

### 1. Site files (`docs/`)

| File | Source | Change |
|---|---|---|
| `_config.yml` | podman | title, baseurl `/nixarchy-distrobox`, `exclude: capture.sh`, a `nav:` over the sections of `usage.md` |
| `_layouts/home.html`, `_layouts/manual.html`, `_includes/logo.html`, `assets/manual.js` | podman, verbatim apart from names | header comment naming the source commit |
| `assets/style.css` | podman's copy of nixarchy's | header naming nixarchy@e3827446bb32 and podman as sources; only the showcase block is changed |
| `index.md` | new | the user story and the tour (§2) |
| `usage.md` | existing | gains front matter (`layout: manual`, `permalink: /usage/`); the text stays one copy |
| `img/` | new | captures (§3), under 8 MB |
| `capture.sh` | podman's shape | demo boxes instead of demo containers (§4) |

**Outside `docs/`:**
- `.github/workflows/pages.yml` is podman's, with `main` in place of
  `master`.
- `ci.yml` gains podman's `docs/img` budget step (8 MB).
- The README gets a link to the site near its top.
- AGENTS.md gets a "Retaking the captures" section.

### 2. `index.md`: the user story

1. **Who it is for.** Someone on Omarchy or nixarchy who keeps Ubuntu, Arch
   or Fedora toolchains in distrobox, and would rather press a key than
   remember `distrobox create` flags.
2. **The problem.** What exists today:
   - `distrobox list` prints a table and nothing else can read it;
   - nothing on the bar says a box is running;
   - create has 25+ flags;
   - an upgrade or a first start holds a terminal for minutes;
   - on nixarchy, short image names don't even resolve.
3. **What it does.** Two ways in, one list, the create form, and a log you
   can leave. Each point has a capture.
4. **How it works.**
   - The engine is queried directly (label `manager=distrobox`).
   - One shared state serves the bar and the menu.
   - Start goes through `distrobox enter -T -- true`, so it waits for setup.
   - Every call carries `DBX_CONTAINER_MANAGER`.
5. **Why it is built this way.**
   - Allowlisted fields, because of distrobox's host-side `eval`, with the
     canary result in one sentence.
   - One change at a time.
   - Delete keeps homes.
   - Cancel is the default answer.
6. **A tour.** Captioned stills and three short recordings (§3).
7. **Set it up.** Nix, then without Nix, then enable, the bind, the menu row,
   and the docker setting. It links to the manual for the rest.

### 3. Captures

**Stills (PNG, cropped to the surface):**
- `glyph.png`: the bar glyph, running and idle;
- `popup.png`: the popup with three demo boxes (running, stopped, failed);
- `menu.png`: the full-screen menu;
- `form.png`: the create form, basic fields;
- `form-advanced.png`: the create form, Advanced open;
- `form-error.png`: an inline error;
- `image-list.png`: the image picker list;
- `log.png`: a create streaming;
- `busy.png`: a refused action;
- `confirm-delete.png`: the delete confirmation, Cancel focused;
- `shortcuts.png`: the `?` sheet;
- `omarchy-menu-row.png`: the Omarchy menu search;
- `settings.png`: the widget's settings form.

**Recordings** (WebM VP9 `-crf 40`, plus an MP4 H.264 `-crf 28` fallback;
`controls muted loop playsinline`; ≤ 25 s each):
- `rec-create`: `c` → form → pick an image → Enter → log streams → Esc →
  footer "… o to watch" → `o`;
- `rec-start-enter`: `s` on a created box ("starting…") → Enter opens a
  shell;
- `rec-menu`: Super+Alt+D (IPC toggle) → move → `?` → Esc.

**A demo GIF** only if it fits the budget; the videos come first.

### 4. `capture.sh`

This is podman's script adapted to boxes. The owner's boxes are never
touched.

- **`--setup`** creates three boxes:
  - `demo-fedora` (Fedora toolbox, started, so it shows as running);
  - `demo-ubuntu` (Ubuntu toolbox, created but not started);
  - `demo-broken` (Fedora toolbox with `--init`, started so it fails with
    "no init found": a real red row).

  It refuses to run if any `demo-*` name exists, and records each box it
  creates in `docs/.capture-created` (git-ignored).
- **`--teardown`** runs `distrobox rm --force` on exactly the recorded names,
  and removes only the home directories `--setup` made.
- **`--shot NAME X,Y WxH`** takes a `grim` crop into `img/NAME.png`, and only
  once the surface's layer is up (`hyprctl layers`).
- **Before and after:** `shell.json` and
  `~/.config/omarchy/extensions/omarchy-menu.jsonc` are backed up by
  `--setup` and restored by `--teardown`.

### 5. Privacy on capture day

- **Isolation:** an empty workspace, the pointer parked off-surface, and do
  not disturb on for notifications.
- **Cropping:** every frame is cropped to the panel or menu, never a full
  screen.
- **Review:** every still and a frame sheet of every video
  (`ffmpeg … tile`) are looked at before they are committed.
- **Afterwards:** `podman ps -a` and both config files are diffed against
  their snapshot, and must be identical apart from `demo-*`.

## Alternatives rejected

- **A theme gem or a static-site framework.** nixarchy and podman use plain
  Jekyll. A different stack would not look the same.
- **Hot-linking nixarchy's stylesheet.** It is copied with a source header
  (an intent constraint), so a change upstream cannot break this site
  silently.
- **Mock-ups or edited frames.** Real captures only (an intent constraint).
- **A separate setup page.** Decision 1: setup lives in both pages.
- **GIFs as the main medium.** At the same quality they are 5–10× the size of
  WebM, and the 8 MB budget would not hold three recordings.

## Risks

- **Personal content in a frame.** Mitigated by cropping, an empty workspace,
  do not disturb, and a review of every frame before commit.
- **The size budget.** CI enforces it. Stills are PNG at 1× and cropped;
  videos are short at a low bitrate.
- **Demo state leaking into the owner's setup.** The script records and
  removes only what it made, and backs up and restores `shell.json` and the
  menu file.
- **Pages build.** The same action as podman's (`jekyll-build-pages`); it is
  checked locally with Jekyll before merge.
- **Nav anchors going stale.** Kramdown heading ids. `_config.yml` carries
  podman's warning comment, and verification runs a link check.

## Verification

- A local Jekyll build succeeds (`nix run nixpkgs#jekyll -- build -s docs`),
  and every internal link and anchor resolves (a script check over `_site`).
- `du -sb docs/img` is at most 8 MB, and the CI step passes.
- Every image and every video frame sheet has been looked at; none shows
  anything but the plugin and `demo-*` boxes.
- `capture.sh --teardown` leaves `podman ps -a --filter
  label=manager=distrobox` empty. `shell.json` and the menu extension file are
  byte-identical to their backups.
- After merge, the Pages workflow deploys, and
  `https://olafkfreund.github.io/nixarchy-distrobox/` and `/usage/` return
  200 with images loading.
- `nix build` output is unchanged: the package's file list excludes
  `docs/`.
