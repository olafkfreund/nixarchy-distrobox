---
status: approved
issue: 17
intent: intent/2026-09-21-17-tour-captures.md
---

# Spec: fix what the razer run found, then retake and publish the tour

## Decisions carried from the intent's open questions

The owner approved the intent and asked for every bug to be solved in this
PR. That settles the three questions:

1. **Fix first, then retake.** The bugs are fixed first, and then every
   capture is retaken on the fixed build, so no published image shows a
   fixed bug.
2. **The README gets a poster frame** (`docs/img/tour.png`) that links to the
   tour on the site. GitHub does not play `<video>` for files in the
   repository.
3. **nixarchy's site** is not changed in this PR. Its entry is filed as an
   issue on olafkfreund/nixarchy, owned there.

## Design

Each bug is listed with its root cause and the fix. Logic goes in `Model.js`
with a Node test, and QML only wires it, as `AGENTS.md` requires.

### B11: `showStopped: false` hides stopped boxes from the state

**Root cause.** `Model.listArgv(engine, showStopped)` drops `-a`, so
`DistroboxState.boxes` never holds a stopped box. That one list feeds four
things:

- `known()`, so IPC `start <stopped box>` answers "No box called …";
- `validateForm`'s duplicate check, so an existing name passes;
- the clone list;
- `summaryText`, so the header says "NO BOXES" while 6 exist.

**Fix.**
- `DistroboxState.refresh` always lists with `-a`. `Model.listArgv` loses its
  `showStopped` argument.
- A new `Model.visibleBoxes(boxes, showStopped, query)` hides stopped boxes
  in the view only: `DistroboxView.visibleBoxes` calls it instead of
  `filterBoxes`.
- The header and footer counts, `known()`, validation and clone keep reading
  the full list.
- `emptyText` keeps "No running boxes" for the case where every box is
  stopped and stopped boxes are hidden.

**B11b: a create reports success when the box already exists.** distrobox
prints `Distrobox named '<n>' already exists.` and exits 0. That can happen
with any setting (for example, a box made in a terminal between two polls).
- `Model.createRefusal(lines)` returns that line, or `""`.
- In `streamProcess.onExited`, a create that exits 0 with a refusal is
  recorded as failed: `streamExit = 1`, and `lastError` holds that line. The
  "The box is created…" note is not appended.

### B3 and B6: the promote snippet

**B3 root cause.** `promoteSnippet` splices the name in as a bare Nix
attribute. `isBoxName` allows `.` and a leading digit, so `my.box` makes
nested attributes and `2box` is a syntax error.

**B3 fix.** Use the bare name only when it is a plain Nix identifier
(`/^[A-Za-z_][A-Za-z0-9_'-]*$/`), and quote it otherwise:
`machines."my.box"`. Box names cannot hold `"`, `\` or `$`, so the quoted form
needs no escaping.

**B6.** The comment says "what podman recorded" whatever the engine.
`promoteSnippet(name, image, engine)` puts in the engine that is actually in
use. The view passes `DistroboxState.engine`.

nixarchy is retiring its own `box promote` (nixarchy #801), so the snippet no
longer has to match it byte for byte. The manual's "same snippet `nixarchy box
promote` prints" line goes.

### B2: the first `j`/`↓` skips row 1

**Root cause.** `moveCursor` computes `cursorIndex + delta`, even while the
cursor is inactive: `reset()` leaves the index at 0 with no highlight, so the
first `j` goes to 1.

**Fix.** `Model.stepCursor(active, index, delta, total)` returns the clamped
index. While the cursor is inactive, the first step lands on the current
index, so the first press highlights row 1 instead of moving past it.
`moveCursor` calls it. The existing "up from the first row goes into the
filter" branch stays in QML, ahead of it.

### B8: `U` stops at the first box that fails

**Root cause.** `distrobox upgrade --all` gives up at the first box whose
container will not start.

**Fix.** Upgrade-all runs one `distrobox upgrade <name>` per box, in list
order, in the same stream, under the same lock:

- `Model.upgradeAllArgvs(engine, names)` builds the argvs;
- `DistroboxState` keeps `streamQueue`, and `mutating` includes it;
- the queue advances in `Qt.callLater`, the same pattern the action queue
  uses, so the lock never drops between two boxes;
- each box's exit is logged (`── <name>: exit N`), and a failed box does not
  stop the rest;
- the final line is built by `Model.upgradeSummary(results)`: `── upgraded 4
  of 6 · failed: Fedora, demo-broken`;
- `streamExit` is non-zero when any box failed, and `lastError` names the
  boxes that failed.

The set of boxes is the same one `--all` used (every box of the engine), so
stopped boxes still get started and upgraded, as before.

### B12: a templates file created later is never read

**Root cause.** `FileView { watchChanges: true }` cannot watch a path (or a
directory) that does not exist yet, so a `boxes.ini` created after the shell
started is never loaded.

**Fix.** The templates `FileView` gets an `id`. `DistroboxState`'s
`onActiveChanged` calls its `reload()` whenever a surface opens. That makes
the manual's promise true ("show up the next time you open the list"). The
watch stays, for edits made while a surface is open.

### B1: stopped boxes sort case-sensitively

`compareBoxes` compares names lowercased first, then as they are, so the
order stays stable.

### B4: the shortcut sheet is see-through

`ShortcutSheet.qml` fills with alpha `0.97` over a theme background that may
itself be translucent. The fill uses the theme colour with alpha `1`.

### B5: the list footer shows in the form, log and snippet

- The key hints on the right of the footer ("? keys c create esc close")
  come from `Model.footerKeys(mode, mutating)`:
  - in list mode they are unchanged;
  - in the form, log and snippet modes they are empty, because each of those
    views draws its own hints.
- `LogView` shows "following · G follow · j k scroll" only when its content
  is taller than the view. A short log or the promote snippet says just
  "esc back".

### B7: the short-name warning shows only while the field has focus

In `CreateForm.qml:474`, a field's warning shows whenever the field has no
error, not only while it is current, so a user who tabbed past `alpine` still
sees it before pressing Enter.

### B9: "Busy … press o to watch" stays up while you watch

`openLog()` calls the existing `DistroboxState.clearBusyNotice()`.

### B13: the menu row advertises Super+Alt+D

The binding is optional and the plugin does not install it, so
`share/omarchy-menu.jsonc` drops "· Super+Alt+D" from `description`.

### B15: the menu card jumps while filtering

**Root cause.** `Menu.qml:117` centres the card on a third of the free space,
so every change in height moves its top edge.

**Fix.** The top edge is fixed at `Math.round(panel.height * 0.12)`, and the
height is capped at `panel.height * 0.8`. The card then grows and shrinks
downwards only.

### B16: the log wraps mid-word

In `LogView.qml:111`, `Text.WrapAnywhere` becomes `Text.Wrap`, which breaks
at word boundaries and still breaks a long hash where it has to.

### The captures

- **A committed tour script.** `docs/tour.sh` is the scripted tour from the
  razer run:
  - it sends keys only while a plugin layer is up;
  - it moves the cursor with the filter plus ↓, never by counting rows.

  `docs/capture.sh` gets a `--tour` mode that records the tour with
  `wl-screenrec` and stops it.
- **Every still and recording is retaken on the fixed build.** The footer,
  the sheet and the wrapping change almost every image. Stills: every
  existing one, plus `promote.png`, `templates.png` and the poster
  `tour.png`.
- **Recordings.**
  - `rec-tour.{webm,mp4}` is new. The first-start wait is sped up 8×, and
    the caption says so.
  - `rec-create`, `rec-start` and `rec-menu` are cut from the same raw tour
    with `ffmpeg -ss/-to`, instead of recorded separately.
  - `docs/img/` stays under 8 MB (about 6.3 MB expected).
- **The docs.**
  - `docs/index.md`: the tour leads, a *Your templates* section with
    `templates.png`, and *Promote* with `promote.png`.
  - `README.md`: the poster frame linking to the site, and the snippet
    wording (B6).
  - `docs/usage.md`: links to the two stills, the promote wording, and the
    `showStopped` change (IPC and the duplicate check see stopped boxes).
- **The capture boxes.** `docs/capture.sh --setup` also writes a demo
  `~/.config/distrobox/boxes.ini`:
  - it refuses if the file already exists;
  - it records the file, so `--teardown` removes it (and the directory, if
    `--setup` made it).

## Alternatives rejected

- **B11: keep listing without `-a`, and ask the engine per action.** That
  adds a process per key and still leaves the header count and the
  duplicate check wrong. Listing `-a` costs one flag.
- **B8: `distrobox upgrade --running` for `U`.** It skips the failing
  stopped box, but it also silently drops every stopped box, which changes
  what `U` means.
- **B12: watch the parent directory.** QML `FileView` has no directory watch,
  and it would have to create `~/.config/distrobox`. Reloading on open is one
  line and matches the manual.
- **B15: animate the jump.** The card still moves; it only moves slowly.
- **Keep the old three clips.** They were recorded on the build before the
  fixes and would show B5. Cutting them from the new tour costs nothing
  extra.

## Risks

- **B11 changes what `hideWhenEmpty` sees.** With `showStopped:false` and
  only stopped boxes, the glyph now stays visible, because boxes exist. That
  is what the README documents ("while there are no boxes"). A user who
  relied on the old behaviour will notice.
- **B8: `U` takes longer on many boxes** (one `distrobox upgrade` per box)
  and prints more log. The 400-line cap already bounds the log.
- **B11b** keys off distrobox's English message. If distrobox changes the
  wording, it falls back to today's behaviour (reported as success), which is
  never worse than now.
- **Retaking captures drives razer's desktop again.** The same safeguards as
  the first run apply:
  - `demo-*` boxes only;
  - config files backed up and restored;
  - do-not-disturb on, then restored;
  - keys only while a plugin layer is up;
  - the box list, homes and config files diffed against a before-snapshot.

  Live `shell.json` edits kill the bar (H1), so settings are changed only
  around a shell restart.
- **Out of this PR:**
  - H1 (the Omarchy shell's `Bar.qml` dies when `shell.json` is saved) lives
    in nixarchy's tree and is filed there;
  - U1 (the menu closed once during a recording) could not be reproduced. It
    is watched for during the retake and filed if it recurs.

## Verification

- **`node tests/run.js`:** the existing 90 pass, plus new rows for:
  - `visibleBoxes`;
  - `createRefusal`;
  - `promoteSnippet` with `my.box`, `2box` and `docker`, where every output is
    also checked with `nix-instantiate --parse`;
  - `stepCursor` (inactive then `j` gives 0; active clamps);
  - `compareBoxes` case order;
  - `upgradeAllArgvs` and `upgradeSummary`;
  - `footerKeys`.
- **The flake:** `nix flake check`, `nix build`, and
  `omarchy plugin validate` on a fresh clone.
- **Live on razer**, with the fixed build installed as a copy per
  `AGENTS.md`, each bug's repro from the run is repeated and now passes:
  - B11: IPC start of a hidden stopped box starts it; the name `demo-fedora`
    is refused in the form; the header says "0 of 6 running";
  - B11b: a box made in a terminal between polls, then created from the
    form, is reported as failed;
  - B3: `p` on a box named `demo.dot` gives `machines."demo.dot"`;
  - B2: the first `j` lands on row 1;
  - B8: `U` with `demo-broken` present upgrades the other boxes and names
    `demo-broken` as failed;
  - B12: creating `boxes.ini` while the shell runs, then opening the menu,
    lists the templates;
  - B1, B4, B5, B7, B9, B13, B15 and B16: checked on the stills.
- **`docs/img` is under 8 MB** (the CI check). Every still, and a frame sheet
  of every video, is looked at before commit.
- **Razer ends matching the before-snapshot.**
