---
status: approved
issue: 1
spec: spec/2026-09-18-1-distrobox-plugin.md
---

# Plan: Keyboard-driven Distrobox plugin for Omarchy (bar widget and menu)

## Approved decisions (self-contained summary)

- **Plugin shape.**
  - `nixarchy.distrobox` with `kinds: ["menu","bar-widget"]` and
    `keepLoaded: true`. Entry points are `Menu.qml` and `Panel.qml`.
  - Settings: `refreshIntervalSec` (30), `showStopped` (true),
    `containerManager` (`podman`|`docker`, default `podman`, never
    auto-detected) and `hideWhenEmpty` (false).
  - One list, no tabs.
- **One shared state.**
  - `DistroboxState.qml` is a directory singleton declared in `qmldir`.
  - Surfaces call `acquire(kind)` and `release(kind)`, where `kind` is `"bar"`
    or `"view"`. The list is polled every 3 s while a view is open and every
    `refreshIntervalSec` while a bar exists. Nothing polls when both are
    closed.
  - Only one mutation runs at a time across both surfaces, because
    `mutating = actionProcess.running || streamProcess.running`.
  - If the loader does not share the singleton, `Menu.qml` forwards mutations
    to the bar over IPC instead.
- **Listing and homes.**
  - The list comes from
    `<engine> ps -a --no-trunc --filter label=manager=distrobox --format BOX_FORMAT`,
    where `BOX_FORMAT` gives ID, Names, Image, State and Status as JSON lines.
  - Homes come from one batched
    `<engine> inspect --format '<name>\t<HOME from .Config.Env>' <ids…>`. It
    reruns only when the set of box ids changes, and the result is cached by
    id.
  - Docker `Names` are normalised: first entry, leading `/` stripped.
- **Engine per operation.**
  - The engine is read from settings when an operation starts and baked into
    its argv.
  - Every distrobox argv starts with `env DBX_CONTAINER_MANAGER=<engine>`.
  - `engineFor(v)` is `"docker"` only when `v === "docker"`, otherwise
    `"podman"`.
- **Commands.** All are argv arrays, never `sh -c`.

  | Command | Argv |
  |---|---|
  | start | `distrobox enter -n N -T -- true` (tracked, so it waits for init; the row shows "starting…") |
  | stop | `distrobox stop --yes N…` |
  | restart | stop, then start (a queued follow-up in `actionProcess`; the lock is held throughout) |
  | remove | `distrobox rm --force N` (the home directory is kept, and the confirm text names it) |
  | upgrade | `env DBX_NON_INTERACTIVE=1 … distrobox upgrade N` or `--all` (streamed) |
  | enter | `omarchy-launch-tui --app-id=org.omarchy.distrobox-enter env DBX_CONTAINER_MANAGER=E distrobox enter N` (via `execDetached`; the surface closes) |
  | create | `Model.createArgv(form, engine)` (streamed, `--yes`) |

- **Stream.**
  - One `streamProcess`, with a `SplitParser` on both stdout and stderr.
  - Lines have ANSI stripped, are capped at 2 KB each, and the log is capped at
    400 lines. Text is `Text.PlainText`.
  - When the process exits, a `── exit N · done|failed` line is added and the
    list refreshes.
  - Esc only hides the log. A shell restart kills the stream (documented).
- **View.**
  - `mode` is one of `list | form | log`, with `helpOpen` and `confirmOpen` as
    overlays.
  - The key catcher is `blocked` whenever `filterField.activeFocus`,
    `confirmOpen`, or `mode !== "list"`.
  - `reset()` runs on every open. It returns to list mode, clears the filter,
    closes the overlays and cancels the form, but leaves the stream and the log
    alone. It then calls `Qt.callLater(focusForMode)`, which focuses the target
    for the *final* mode.
  - `ConfirmDialog.selectedIndex = 0` is set every time the dialog opens, and
    keys reach it as in `PodmanView.qml:213-220`.
- **List keys.**

  | Key | Action |
  |---|---|
  | `j` `k` ↑ ↓ | move |
  | `/` | filter |
  | Enter or `e` | enter the box |
  | `s` | start or stop |
  | `r` | restart |
  | `g` | upgrade this box |
  | `U` | upgrade all |
  | `S` | stop all (asks to confirm) |
  | `x` | delete (asks to confirm) |
  | `c` | open the create form |
  | `y` | copy the name |
  | `o` | show the log |
  | `u` | refresh |
  | `?` | help |
  | Esc | step back |
  | Tab | next bar panel |

- **Form keys.**
  - Tab, Shift+Tab, ↑ and ↓ move between fields.
  - `j` and `k` also move, except while a text field has focus.
  - Space toggles a switch or expands a section. Enter validates and creates.
    Esc cancels.
  - The image field is a TextField with an inline filtered `Model.IMAGES` list
    below it, not a Popup. ↓ moves into the list, Enter picks, Esc goes back.
  - Basic fields: name, image, pull, home, additionalPackages, init, nvidia.
  - Advanced fields (collapsed): hostname, clone (only stopped boxes), volumes,
    additionalFlags, initHooks, preInitHooks, platform, unshareAll and the five
    individual unshare flags, noEntry.
- **Log keys.**
  - Esc hides the log.
  - `j`/`k` scroll and turn follow off.
  - `G` or End jumps to the tail and turns follow back on.
- **Input allowlists** (spec §6). `createArgv` returns null unless every field
  passes.

  | Field | Rule |
  |---|---|
  | name | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$`, and not already taken |
  | hostname | RFC 1123, at most 64 characters |
  | image | OCI reference; a short name only warns |
  | platform | `^[a-z0-9]+/[a-z0-9_]+(/[a-z0-9]+)?$` |
  | home | `[A-Za-z0-9_./~+-]`, absolute or starting `~/` |
  | volumes | tokens of `src:dst[:opts]` |
  | additionalPackages | tokens of `[A-Za-z0-9_.+:@=-]+` |
  | additionalFlags | tokens matching `^--?[A-Za-z0-9][A-Za-z0-9-]*(=[A-Za-z0-9_./:@,+=-]*)?$` |
  | preInitHooks | none of `" \ $ \`` and no control characters |
  | initHooks | no `'` and no control characters |
  | clone | an existing, stopped box |

- **Look.**
  - The header is a `PanelHero` titled "Distrobox", with a line such as
    "N of M running".
  - Each row shows a state dot (accent, dim outline, or urgent), the name, the
    line `shortImage · homeLabel`, the status, and buttons.
  - The footer has a hairline, a message line, and a three-slot line ending in
    `? keys  c create  esc close`.
  - Only `Color.*`, `Style.*` and `Border.*` are used. The menu keeps
    `scale: 1.45`.
- **Packaging.**
  - `runCommand` copies the runtime `files` list as real files. There is no
    Home Manager or NixOS module.
  - `checks.default` runs:
    - the Node tests;
    - jq assertions on the manifest;
    - a check that the entry points exist;
    - bans on symlinks, `pacman`/`yay`, and `"#hex"` literals in QML.
- **Out of v1.** `--rm-home`, `--root`, auto engine detection,
  `generate-entry` and export, volume paths with spaces, `assemble`,
  restart-durable streams, and host flake wiring.

## Steps

Each step is one commit on `feat/1-distrobox-plugin`, titled
`<type>: … (#1)`, and cited as `plan step N`. A deviation updates this file in
the same commit.

1. **Scaffold.** Add `LICENSE` (MIT), `manifest.json` as specified in spec §2,
   and `.gitignore` (`result`). Also add:
   - `AGENTS.md`: podman's rules, plus three more: "every distrobox argv carries
     the engine", "one mutation at a time via the singleton", and "every form
     field is allowlisted for its host quoting context";
   - `CLAUDE.md` containing `@AGENTS.md`;
   - `.github/copilot-instructions.md`.

   → Verify: `jq -e '.id=="nixarchy.distrobox" and .keepLoaded' manifest.json`
   and `find . -type l` returns nothing.
2. **`Model.js` parsing, rows and settings, with tests.** Add
   `tests/harness.js` and `tests/run.js` (from podman; the fixtures become
   `psRow` and `dockerRow`). Add `parsing.test.js`, `rows.test.js` and
   `settings.test.js`. Model covers:
   - `parseJsonLines`, `normalizeName`, `normalizeBox(es)`, `parseHomes`,
     `homeLabel`;
   - `counts`, `summaryText`, `emptyText`, `errorText`;
   - `filterBoxes`, `sortBoxes`;
   - `rowsFor`, `rowRecord`, `ROW_FIELDS`, `reconcilePlan`, `clampCursor`;
   - `settingsFor`, `stripAnsi`, `capLine`, `Glyph`, `SHORTCUTS`,
     `shortcutGroups`.

   → Verify: `node tests/run.js` passes, and the test files use both podman and
   docker fixtures.
3. **`Model.js` commands and form, with tests.** Add `commands.test.js` and
   `form.test.js`. Model covers:
   - the validators;
   - `engineFor` and every `*Argv`;
   - `emptyForm`, `validateForm`, `createArgv`, `formSummary`;
   - `IMAGES`, `DEFAULT_IMAGE`, `removeMessage`, `stopAllMessage`;
   - `actionsFor(row, lock)`.

   The form tests include a hostile table for each field: `$(id)`, a backtick,
   `;`, `|`, `&`, `>`, `<`, both quote characters, `\`, a newline, and `${HOME}`
   where that field forbids it.

   → Verify: `node tests/run.js` passes, and every distrobox argv starts
   `["env","DBX_CONTAINER_MANAGER=…"`.
4. **`qmldir` and the `DistroboxState.qml` singleton, plus a minimal
   `Panel.qml` and `Menu.qml`.** The state holds:
   - the processes and timers;
   - `acquire`/`release`;
   - the lock, `pendingId`, `lastError`, and the restart follow-up queue;
   - the homes cache;
   - the stream and log.

   The two hosts do nothing yet except bind to the singleton and show its
   counts.

   → Verify: build a dev copy with
   `cp -r . ~/.config/omarchy/plugins/nixarchy.distrobox` (real files, no
   `.git`), then run `omarchy plugin enable nixarchy.distrobox`,
   `omarchy-restart-shell` and `qs log -i <id>`, and check there are no QML
   errors. **Singleton check:** start `distrobox stop` from the bar through a
   temporary IPC call and confirm the menu shows `mutating`. If it does not,
   switch to the IPC-forwarding fallback and record the deviation here.
5. **`BoxList.qml`, `ShortcutSheet.qml`, `DistroboxView.qml` (list mode) and
   the full `Panel.qml`.** Covers the list keys, filter, confirm dialog, help,
   header and footer.
   → Verify, live:
   - the empty state reads "No boxes yet — press c to create one";
   - after `distrobox create --yes -n t1 -i registry.fedoraproject.org/fedora-toolbox:latest`
     on the CLI, the row appears with its home label;
   - `s` shows "starting…" until initialisation finishes;
   - `x` opens the confirm dialog with Cancel selected;
   - `?` and `/` work;
   - `qs log` is clean.
6. **`LogView.qml` and stream wiring.** Covers `g`, `U`, `o`, Esc to detach,
   follow and scroll, and the footer's stream status.
   → Verify, live on `t1`:
   - `g` streams the upgrade;
   - Esc returns to the list while `pgrep -af "distrobox upgrade"` still shows
     the job;
   - `o` reattaches;
   - `j`/`k` scroll, and `G` follows again;
   - the exit line appears;
   - `s` during the stream is refused, with a message.
7. **`CreateForm.qml` and form mode.** Covers the fields, the Advanced toggle,
   the inline image list, inline errors, and Enter to create the stream.
   → Verify:
   - a keyboard-only create of `t2` with `--home ~/.local/share/distrobox/t2`,
     one volume, `--additional-packages "git tmux"` and `--init` matches
     `podman inspect t2`;
   - an invalid name keeps the form open with an error;
   - the clone list omits running boxes.

   **Injection proof:** for each hostile sample that passes a field's allowlist
   by design (hooks), run
   `env DBX_CONTAINER_MANAGER=podman distrobox create --dry-run <createArgv…>`
   (the argv printed by a `node -e` helper) and check that the sample appears
   only inside its quotes. Samples that fail the allowlists never reach argv,
   which the unit tests show. Record the results here.
8. **The full `Menu.qml` and `share/omarchy-menu.jsonc`.** Covers the payload
   `{"create":true}`, the focused monitor, the scrim and scale.
   → Verify:
   - `omarchy-shell shell toggle nixarchy.distrobox '{}'` opens the menu;
   - `'{"create":true}'` opens the form with focus in the name field;
   - `'garbage'` falls back to the list;
   - Esc closes, and toggling again reopens;
   - `hyprctl layers -j | grep nixarchy-distrobox-menu`;
   - a mutation in the menu is refused in the bar popup while it runs.
9. **`flake.nix`, `flake.lock` and `.github/workflows/ci.yml`.**
   → Verify:
   - `nix flake check` and `nix flake check --all-systems --no-build` pass;
   - `nix build` produces exactly the 12 runtime files with no symlinks;
   - `omarchy plugin validate "$(readlink -f result)"` passes;
   - a planted `"#ff0000"`, a planted symlink, and a planted `pacman` each make
     the check fail (each reverted, never committed).
10. **`docs/usage.md` and `README.md`.** Cover:
    - requirements: `distrobox`, `podman` or `docker`, `omarchy-launch-tui`,
      `wl-copy`;
    - installing with Nix (`programs.nixarchy.plugins."nixarchy.distrobox".src`)
      and without Nix;
    - `omarchy plugin enable`;
    - the bind `o.bind("SUPER + ALT + D", "Distrobox", "omarchy-shell shell toggle nixarchy.distrobox '{}'")`
      and the menu row;
    - the keys (quoting `SHORTCUTS`), the create form, settings and IPC;
    - troubleshooting: short image names, `--root`, the allowlist limits (no
      spaces in paths, no `$VAR` in pre-init hooks), and streams dying on a
      shell restart;
    - removal.

    → Verify: every key in the docs appears in `Model.SHORTCUTS` (checked with
    grep), and the ids and IPC names match the manifest and `Panel.qml`.
11. **Close-out.** Fill in the implementation record below. Open a PR
    (`Closes #1`) that links `intent/`, `spec/` and `plan/`.
    → Verify: CI is green on the PR.

## Tests

- **A. Node.** `node tests/run.js`, all passing:

  | File | Covers |
  |---|---|
  | `parsing` | podman and docker fixtures, `normalizeName`, `parseHomes`, invalid names dropped |
  | `rows` | sort, filter, `reconcilePlan`, `clampCursor`, `counts`, `summaryText`, `emptyText`, `actionsFor` with and without the lock |
  | `commands` | argv shape, engine prefix, `engineFor`, null on bad names, `rm` without `--yes`, stop with several names, upgrade `--all` |
  | `form` | defaults, required fields, duplicate name, clone must be stopped and disables image, short-name warning, a hostile table for each field, volumes split into repeated `--volume`, `--unshare-all` suppressing the five, each boolean mapping to exactly its flag, a full round-trip |
  | `settings` | podman's cases with this id, plus the `containerManager` enum |

- **B. Nix.** `nix flake check`, `nix flake check --all-systems --no-build`,
  `nix build`, and `omarchy plugin validate` on `result` and on a fresh clone
  without `.git`.
- **C. Injection proof.** The `--dry-run` table from step 7.
- **D. Live checklist**, after `omarchy-restart-shell` and
  `omarchy-shell shell ping`, with a clean `qs log`:
  1. The bar glyph shows 0/0, then 0/1, then 1/1. `hideWhenEmpty` hides it.
     Middle-click refreshes.
  2. Every list key works once in the popup and once in the menu.
  3. A mutation started in one surface is refused in the other.
  4. `toggle '{"create":true}'` gives the form focus.
  5. A keyboard create through the Advanced fields matches `podman inspect`.
  6. Start shows "starting…". Enter afterwards opens a shell immediately.
  7. A stream survives Esc and closing the surface.
  8. Delete keeps the home directory.
  9. With everything closed, only the bar's slow `podman ps` runs.
  10. With `containerManager: docker`, a process listing shows
      `DBX_CONTAINER_MANAGER=docker` for enter, stop and rm.
  11. A theme switch (`omarchy-theme-set <other>`) recolours the panel live.

## Rollback

- **Before merge:** close the PR and delete `feat/1-distrobox-plugin`. `main`
  holds only the empty initial commit.
- **After merge:** `git revert` the merge commit.
- **Local install:**
  1. `omarchy plugin disable nixarchy.distrobox`
  2. `rm -rf ~/.config/omarchy/plugins/nixarchy.distrobox`
  3. `omarchy-restart-shell`

  This also ends any running stream.
- **Boxes and step order:** boxes created during testing (`t1`, `t2`) are
  ordinary boxes, removed with `distrobox rm t1 t2`. The Model steps (2–3) and
  the flake step (9) can each be reverted independently of the QML.

## Implementation record

### Deviations

1. **Step 3: `~/` expansion in Model.** A leading `~/` in `home` and in each
   volume side is expanded to `$HOME` in `createArgv`. distrobox puts `--home`
   inside `"…"`, where the host shell does not expand `~`, and
   `distrobox-create:891` would `mkdir -p` a literal `~` directory. This does
   not change the allowlist; it is what makes the approved "absolute or `~/`"
   rule mean what it says.
2. **Step 5: stop signals are not failures.** Found live: a clean
   `distrobox stop` leaves `Exited (143)` (the box's init got SIGTERM), and a
   stop that times out leaves `137` (SIGKILL). The spec's "urgent when the
   exit code is not 0" painted every stopped box red. Exit codes 129, 130, 137
   and 143 now read "Stopped" and are not `failing`; any other non-zero code
   still does.
3. **Step 5: the `?` sheet scrolls.** 23 shortcuts do not fit the bar popup.
   `ShortcutSheet.qml` wraps its column in a `Flickable`, and j/k scroll it
   while it is open (it is no longer a verbatim podman copy).
4. **Step 6: a "Busy: …" refusal clears itself.** Found live: the refusal
   stayed on screen after the operation it described had finished. Every
   exit handler now drops a `Busy: ` notice (`clearBusyNotice`); real errors
   stay until dismissed.
5. **Step 7: form layout lives in Model.** Field order, kinds, labels and
   hints are data (`Model.FORM_FIELDS`, `visibleFields`, `firstErrorIndex`,
   `stoppedBoxNames`, `nextClone`), with tests, rather than hard-coded in QML.
6. **Step 7: compact switch rows instead of the shell's `Toggle`.** `Toggle`
   is a full card with a title and a description; 14 of them do not fit a
   popup. Switch rows use nixarchy-pkg's `■`/`□` glyph style, and the whole
   form uses `Color.*`/`Style.*` only.
7. **Step 7: two focus fixes, found live.** (a) Moving from a text field to a
   switch row left the keyboard in the text field, because
   `forceActiveFocus()` on a FocusScope restores its last focused child.
   Switch rows now focus a dedicated `keySink` item instead. (b)
   `KeyboardPanel` focuses the key catcher on its own schedule after an IPC
   `create`. The catcher now hands focus on to the current mode's target
   whenever it gains focus outside list mode.
8. **Step 9: two checks beyond podman's.** (a) The flake check also scans
   the *repository* for symlinks, not only the package. The planted-symlink
   test showed that a repo symlink never reaches the package (`cp` follows
   it), so podman's package-only check passes it, yet `omarchy plugin add`
   clones the repo and would refuse it. (b) It asserts that `qmldir`
   declares the `DistroboxState` singleton; without that line the lock
   silently stops being shared.
9. **Step 4: no fallback needed.** The menu and all three monitor bars report
   the same singleton instance, so the IPC-forwarding fallback was not built.

### Test results

- **Step 4, live:** the singleton is shared (same `instance` from the menu
  and from the bar). A start from the bar holds the lock; a concurrent
  `stopAll` is refused with "Busy: starting t1 — wait for it to finish";
  `DBX_CONTAINER_MANAGER=podman` is in the distrobox process environment.
- **Step 5, live (bar popup, driven with `wtype`):** the list renders with
  the theme. `j` `x` opens the delete confirm with Cancel focused; Enter
  cancels and `t1` survives. `?` opens the sheet. `s` stops, then starts
  (the row shows "starting…" and every mutation button is disabled until
  init is done). Esc closes, and `views` drops to 0. `qs log` has no QML
  errors from the plugin.
- **Step 6, live:**
  - `g` on `t1` streamed a dnf upgrade and ended with `── exit 0 · done`.
  - `g` on a never-started `t2` (ubuntu-toolbox 24.04) streamed its first-start
    setup and an apt upgrade for several minutes.
  - Esc returned to the list while the `distrobox upgrade t2` process kept
    running (`pgrep`). `s` on `t1` was refused with "Busy: upgrade t2 — press
    o to watch", and every mutation button was disabled. `o` reattached.
  - `k` switched the hint to "G follow"; `G` went back to "following" at the
    end.
  - The exit line arrived and the list refreshed.
  - *Host note:* the first `t2` pull failed with "no space left on device"
    because `/var/tmp` (a 2 GB tmpfs) was full of pytest leftovers. The owner
    approved removing them.
- **Step 7, live:**
  - `omarchy shell nixarchy.distrobox.bar create` opened the popup with the
    form focused, and typing went into Name.
  - An invalid name ("bad name") showed its error inline and kept the form
    open; nothing was created.
  - A keyboard-only create of `t3` covered: the image picked from the inline
    list, `--home ~/.local/share/distrobox/t3`, `git tmux`, `--init`, Advanced
    opened, and `~/Documents:/mnt/docs:ro`.
  - `podman inspect t3` confirms every value: `HOME` is expanded to an
    absolute path, the volume is mounted read-only, `--init 1` is set, and
    the packages are `git tmux`. No literal `~` directory was created.
  - The clone field cycled `t2` → `t3` and skipped the running `t1`.
- **Step 7, injection proof (real create, box never started):**
  - Hooks that pass the allowlists but are full of shell (`;`, `&&`, `|`,
    `$( … )`, backticks, each writing a canary file) created **no** canary on
    the host. `podman inspect` shows them stored verbatim.
  - **Control:** the same create with a raw argv that bypasses validation, a
    `'` in the init hook, **did** run its canary on the host. That shows the
    test detects an escape, and `validateForm` rejects exactly that input
    ("Cannot contain ' or line breaks").
- **Step 8, live (menu):**
  - `toggle '{}'` opened `nixarchy-distrobox-menu` on the focused monitor
    (DP-2), at 1.45×. Rows show custom homes (`~/.local/share/distrobox/t3`)
    and the "Stopped" and "Created" states.
  - Esc removed the layer, and toggling again brought it back.
  - `'{"create":true}'` opened straight into the form, and typing landed in
    Name.
  - `'garbage{'` fell back to the list.
  - A start of `t3` from the menu held the lock. `start t2` from the bar's IPC
    was refused ("Busy: starting t3"). Esc closed the menu (`views` 0) while
    the start kept running.
- **Step 9:**
  - `nix flake check` passes (55 Node tests run in the sandbox), and so does
    `nix flake check --all-systems --no-build`.
  - `nix build` contains exactly the 12 runtime files, with no symlinks.
  - `omarchy plugin validate` passes on `result` and on a fresh clone without
    `.git`.
  - Planted faults, each in a scratch clone: `"#ff0000"` in QML → caught;
    `// pacman` → caught; a repo symlink → **not caught** until check (a)
    above was added, then caught.

### Review fixes

_Pending._
