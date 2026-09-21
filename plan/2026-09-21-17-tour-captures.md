---
status: approved
issue: 17
spec: spec/2026-09-21-17-tour-captures.md
---

# Plan: fix what the razer run found, then retake and publish the tour

## Approved decisions

Every bug the live run on razer (2026-09-21) found in this repo is fixed in
this PR. Then every capture is retaken on the fixed build and published.

- **Logic** goes in `Model.js`, with rows in `tests/model/*.test.js`. QML only
  wires it.
- **B11.** The state always lists every box (`ps -a`). `showStopped` hides
  stopped boxes in the view only, through `Model.visibleBoxes(boxes,
  showStopped, query)`. The header and footer counts, `known()` (IPC and
  keys), `validateForm`'s duplicate check and the clone list all read the
  full list.
- **B11b.** A create that exits 0 but printed `Distrobox named '<n>' already
  exists` is recorded as failed. `Model.createRefusal(lines)` finds the line.
  The stream sets `streamExit = 1` and `lastError` to that line, and does not
  add the "box is created" note.
- **B3.** The promote attribute is bare only when it is a Nix identifier
  (`/^[A-Za-z_][A-Za-z0-9_'-]*$/`), and quoted otherwise
  (`machines."my.box"`).
- **B6.** `promoteSnippet(name, image, engine)` names the engine in its
  comment. The manual drops "the same snippet `nixarchy box promote` prints".
- **B2.** `Model.stepCursor(active, index, delta, total)`: an inactive cursor
  lands on the current index, and an active one moves and clamps. The QML
  branch "up from row 1 goes into the filter" stays first.
- **B8.** `U` runs one `distrobox upgrade <name>` per box, in list order, in
  one stream under one lock:
  - `Model.upgradeAllArgvs(engine, names)` builds them;
  - `DistroboxState.streamQueue` holds the rest and counts toward `mutating`;
  - the queue advances in `Qt.callLater`;
  - each box logs `── <name>: exit N`;
  - the end line comes from `Model.upgradeSummary(results)`: `── upgraded
    4 of 6 · failed: a, b`;
  - `streamExit` is non-zero when any box failed, and `lastError` names the
    boxes that failed.
- **B12.** The templates `FileView` gets `id: templatesFile`, and is reloaded
  in `onActiveChanged` whenever a surface opens.
- **B1.** `compareBoxes` compares names lowercased, then as they are.
- **B4.** The shortcut sheet fills with the theme background at alpha 1.
- **B5.** The footer key hints come from `Model.footerKeys(mode, mutating)`:
  - `"working…"` while a change runs, and the list hints otherwise, in list
    mode;
  - `""` in the form, log and snippet modes.

  `LogView` shows its follow and scroll hints only when its content
  overflows, and just "esc back" otherwise.
- **B7.** A field warning shows whenever the field has no error, not only
  while it has focus.
- **B9.** `openLog()` calls `DistroboxState.clearBusyNotice()`.
- **B13.** `share/omarchy-menu.jsonc` drops "· Super+Alt+D".
- **B15.** The menu card's top is fixed at `panel.height * 0.12`, and its
  height is capped at `panel.height * 0.8`.
- **B16.** `LogView` wraps with `Text.Wrap`.
- **Captures.**
  - `docs/tour.sh` is the scripted tour: keys only while a plugin layer is
    up, and the cursor is moved by filter plus ↓.
  - `docs/capture.sh --tour OUT` records it with `wl-screenrec`.
    `--setup` stages a demo `~/.config/distrobox/boxes.ini` (it refuses if
    one exists, and records it for teardown).
  - Everything is retaken on the fixed build: every existing still, plus
    `promote.png`, `templates.png` and the poster `tour.png`.
  - `rec-tour.{webm,mp4}` has the first-start wait sped up 8×, and says so.
    `rec-create`, `rec-start` and `rec-menu` are cut from the same raw tour.
  - `docs/img` stays under 8 MB.
  - The README gets the poster linking to the site. `docs/index.md` gets the
    tour, *Your templates* and *Promote*. `docs/usage.md` links the stills
    and gets the wording changes.
- **Out of the PR:**
  - H1 (the shell's `Bar.qml` dies on a `shell.json` save) and nixarchy's
    site entry are filed as issues on olafkfreund/nixarchy;
  - U1 is watched for during the retake.

## Steps

One commit per step, each citing its step (`… (#17, plan 3)`). Each commit
that makes a user-visible change updates `README.md` and `docs/usage.md` in
the same commit.

1. **B1 sort.** In `Model.js:284` `compareBoxes`, compare `a.name.toLowerCase()`
   first, then `a.name`. `tests/model/rows.test.js` gets a row where
   `["demo-u", "Debian", "Fedora"]`, all stopped, sort to
   `Debian, demo-u, Fedora`.
   → verify by `node tests/run.js` green.
2. **B11 list all, filter in the view.**
   - `Model.js`:
     - `listArgv(engine)` always has `-a`;
     - add `visibleBoxes(boxes, showStopped, query)`, which filters out
       boxes that are not `up` when `showStopped === false`, then applies
       `filterBoxes`.
   - `DistroboxState.qml:88`: `Model.listArgv(root.engine)`. Drop
     `onShowStoppedChanged`'s refresh, since the view re-derives itself.
   - `DistroboxView.qml`: `visibleBoxes` uses
     `Model.visibleBoxes(DistroboxState.boxes, DistroboxState.showStopped,
     filterText)`.
   - The empty-state call passes `filtered: root.filterText.trim() !== ""`
     instead of `boxes.length > 0`, since the full list is now never empty
     when boxes exist. `emptyText`'s existing order then gives:
     - "Nothing matches that filter" when a filter is typed;
     - "No running boxes" when no filter is typed, stopped boxes are hidden
       and none run;
     - "No boxes yet" otherwise.
     `rows.test.js` gets rows for these three `emptyText` inputs.
   - Tests:
     - `commands.test.js:78` now asserts that `-a` is always present;
     - new `visibleBoxes` rows: hidden stopped, the query applied after,
       and `showStopped` true passes everything.
   - `README.md:145` becomes: `showStopped` off hides stopped boxes from the
     list; they still count, and a name they use is still taken.
   → verify by `node tests/run.js` green.
3. **B11b create refusal.**
   - `Model.js`: `createRefusal(lines)` returns the first line matching
     `/^Distrobox named '.*' already exists/`, or `""`.
   - `DistroboxState.qml` `streamProcess.onExited`: when the title starts
     with `create `, the code is 0 and there is a refusal, then set
     `code = 1`. `lastError` gets the refusal, the exit line says failed, and
     there is no "created" note.
   - `form.test.js` or `commands.test.js` rows: the refusal is found in a
     realistic log, ANSI-stripped, and a success log gives `""`.
   → verify by `node tests/run.js` green.
4. **B3 and B6 promote.**
   - `Model.promoteSnippet(name, image, engine)`: the attribute is bare or
     quoted as decided, and the comment line reads `knows what <engine>
     recorded`, with `engineFor(engine)` so the default stays podman.
   - Found while implementing: Nix keywords (`if`, `in`, `let`, `or`, `rec`,
     `with` and the rest) match the identifier pattern but cannot be bare
     attribute names, and `isBoxName` allows them. They are quoted too
     (`nixAttrName`).
   - `DistroboxView.promote` passes `DistroboxState.engine`.
   - `commands.test.js`:
     - the existing literal row gets the engine;
     - new rows for `my.box`, `2box` and docker.
   - A new check in `tests/model/commands.test.js` shells out to
     `nix-instantiate --parse` when it is on `PATH`, and is skipped otherwise.
     `nix flake check` runs without nix inside the sandbox, so the parse
     check is also run by hand in step 13.
   - `docs/usage.md`: drop the "same snippet `nixarchy box promote` prints"
     sentence.
   → verify by `node tests/run.js` green, and by `nix-instantiate --parse`
   on the three outputs.
5. **B2 cursor.**
   - `Model.stepCursor(active, index, delta, total)`: `total <= 0` gives 0;
     an inactive cursor gives `clampCursor(index, total)`; otherwise
     `clampCursor(index + delta, total)`.
   - `DistroboxView.moveCursor` uses it, after the existing up-into-filter
     branch.
   - Rows: inactive with `j` gives 0; active 0 with `j` gives 1; active last
     with `j` stays last; inactive with `k` gives 0.
   → verify by `node tests/run.js` green.
6. **B8 upgrade all, per box.**
   - `Model.upgradeAllArgvs(engine, names)` returns
     `[upgradeArgv(engine, n) …]`, or `null` for an empty list or any bad
     name.
   - `Model.upgradeSummary(results)` takes `[{name, code}]` and returns the
     end line.
   - `DistroboxState`:
     - `upgrade(null)` builds the argvs from every box name, sets
       `streamQueue` to the rest and `streamResults = []`, then starts the
       first with `startStream`;
     - `streamProcess.onExited` pushes `{name, code}`, logs
       `── <name>: exit <code>`, and, while the queue is non-empty,
       launches the next in `Qt.callLater` (taking it off the queue in the
       same step) and returns;
     - after the last box, it logs the summary and sets `streamExit` to 1 if
       any box failed, else 0;
     - `mutating` and `streaming` count `streamQueue.length > 0`;
     - `streamName` and the row "upgrading…" follow the current box.
   - Rows: the argv list, a bad name giving `null`, and summaries for all
     ok, some failed and all failed.
   - `docs/usage.md` *Upgrade*: `U` upgrades the boxes one at a time, and a
     box that fails does not stop the rest.
   → verify by `node tests/run.js` green.
7. **B12 templates reload.** In `DistroboxState.qml`, the templates
   `FileView` gets `id: templatesFile`, and `onActiveChanged` becomes
   `if (active) { refresh(); templatesFile.reload() }`. There is no Model
   change.
   → verify live in step 13.
8. **B5 and B9 footer.**
   - `Model.footerKeys(mode, mutating)` as decided, with rows.
   - `DistroboxView.qml` uses it for the right-hand footer text, and hides
     the "finished · o shows the log" status line outside list mode.
   - `openLog()` calls `DistroboxState.clearBusyNotice()` before
     `setMode("log")`.
   - `LogView.qml:122`: show the follow and scroll hints only when
     `contentHeight > height` for its list (or `running`); otherwise just
     `"esc back"`.
   → verify by `node tests/run.js` green.
9. **B4, B15 and B16 drawing.**
   - `ShortcutSheet.qml:32`: alpha `1`.
   - `Menu.qml:117`: `y: Math.round(panel.height * 0.12)`. The card's
     `height` cap changes from `0.85` to `0.8`.
   - `LogView.qml:111`: `Text.Wrap`.
   → verify on the stills in step 13.
10. **B7 warning.** `CreateForm.qml:474`: drop the `fieldItem.isCurrent &&`
    guard on the warning branch only (hints stay focus-only).
    → verify live in step 13.
11. **B13 menu row.** `share/omarchy-menu.jsonc`: drop " · Super+Alt+D"
    from `description`.
    → verify by `nix flake check` (the file is in the package).
12. **Package checks.**
    - `nix flake check`, `nix flake check --all-systems --no-build` and
      `nix build`;
    - `omarchy plugin validate` on a fresh clone (the `AGENTS.md` recipe);
    - no commit unless a check needs a fix.
13. **Live verification on razer**, with no commit.
    - **Snapshot first:** box lists, homes, the checksums of `shell.json`
      and the menu file, do-not-disturb, and
      `readlink ~/.config/omarchy/plugins/nixarchy.distrobox`.
    - **Install the built copy** per `AGENTS.md`, replacing the managed
      symlink, and restart the shell.
    - **Repeat each repro with `t*` boxes**:
      - B11: IPC start of a hidden stopped box, the duplicate name refused,
        the header count;
      - B11b: `distrobox create t1` in a terminal between polls, then the
        same name from the form, which reports failed;
      - B3: a box `t1.dot`, where `p` gives `machines."t1.dot"` and
        `nix-instantiate --parse` accepts it;
      - B2: the first `j` lands on row 1;
      - B8: `U` with a failing box present finishes the rest and names the
        failure;
      - B12: create `boxes.ini` while the shell runs, open the menu, and the
        templates are there;
      - B7: `alpine` still warns after Tab.
    - Settings changes go around a shell restart only (H1).
    - Remove the `t*` boxes and their homes.
14. **Tour tooling.**
    - `docs/tour.sh`: the razer script, with the layer check on every key,
      and `sel` / `unfilter` helpers.
    - `docs/capture.sh`:
      - `--tour OUT` runs `wl-screenrec` around `docs/tour.sh` and stops it
        with SIGINT;
      - `--setup` stages `~/.config/distrobox/boxes.ini` with `dev-ubuntu`,
        `dev-ubuntu-rust` and `dev-root` (refused, root), refusing if the
        file exists, and records `file` and `dir` lines;
      - `--teardown` removes exactly those.
    - Neither script is a runtime file, so the `flake.nix` `files` list does
      not change.
    → verify by `bash -n` on both, and a dry `--setup` refusal when the file
    exists.
15. **Retake.** On razer, with the fixed copy still installed:
    - `--setup`, DND on, an empty workspace, and the pointer parked;
    - the stills with `--shot`, at the sizes the site already uses (popup
      484 px wide, menu 1030 px);
    - `--tour`;
    - encode, and cut the three section clips from the raw tour
      (`ffmpeg -ss/-to`);
    - look at every still and a frame sheet of every video;
    - `du -sb docs/img` under 8 MB;
    - then `--teardown`, DND off, and diff against the step-13 snapshot.
    - Put the managed plugin symlink back:
      `ln -sfn <saved target> ~/.config/omarchy/plugins/nixarchy.distrobox`,
      then restart the shell.
    - Commit `docs/img` only.
16. **Docs for the captures.**
    - `docs/index.md`: `rec-tour` leads with the sped-up note, plus new
      *Your templates* (`templates.png`) and *Promote* (`promote.png`)
      sections.
    - `README.md`: the poster `tour.png` linking to the site, under the
      opening line.
    - `docs/usage.md`: link the two stills from their sections.
    - Found while verifying: Jekyll published `docs/tour.sh` as a page asset,
      so `docs/_config.yml` excludes it next to `capture.sh`.
    → verify by `bundle exec jekyll build` if it is available, or by
    checking every `img/` reference resolves to a file.
17. **Follow-ups filed and the PR opened.**
    - Issues on olafkfreund/nixarchy: H1, with the log lines and the repro;
      and the site entry for this plugin.
    - Push, then open the PR:
      - it links the intent, spec and plan and closes #17;
      - it carries the step-13 results.

## Tests

```bash
node tests/run.js                              # all green, new rows included
nix flake check                                # tests, manifest, no symlinks, no hex colours, no pacman/yay
nix flake check --all-systems --no-build
nix build
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
du -sb docs/img                                # < 8388608
```

Live checks are listed in step 13.

## Rollback

- Every step is its own commit, so `git revert <sha>` undoes one fix alone.
- The captures (steps 15 and 16) revert as a pair, which restores the
  previous images and pages.
- On razer:
  - `docs/capture.sh --teardown` removes the demo boxes and the templates
    file;
  - `ln -sfn <saved target> ~/.config/omarchy/plugins/nixarchy.distrobox`
    puts the managed plugin back;
  - `omarchy-restart-shell` reloads it.
