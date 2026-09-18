---
status: draft
issue: 1
intent: intent/2026-09-18-1-distrobox-plugin.md
---

# Spec: Keyboard-driven Distrobox plugin for Omarchy (bar widget and menu)

## Decisions taken from the intent's open questions

The owner accepted every default:

1. **Engine:** a `containerManager` setting, either `podman` (the default) or
   `docker`. There is no auto-detect.
2. **`--root` boxes:** not in v1.
3. **Delete:** keeps the box's home directory, and the confirm text names the
   path. `--rm-home` is a follow-up.
4. **Keys:** Enter opens the box in a terminal. `s` starts or stops it.
5. **Shell restart:** a running create or upgrade dies with the shell. This is
   documented, not engineered around.

## Facts this design rests on

All checked against distrobox 1.8.2.5 and Omarchy 4.0.x on this host:

- `distrobox list` has no machine-readable output. Internally it runs
  `<manager> ps -a --no-trunc --format …`. Every box has the label
  `manager=distrobox` (`distrobox-create:723`).
- `distrobox-create:1088` runs `eval ${cmd}` on the host. User fields land in
  four different quoting contexts:

  | Context | Fields | Location |
  |---|---|---|
  | unquoted | `--volume` | `:583` |
  | unquoted | `--platform` | `:687` |
  | unquoted | additional flags | |
  | unquoted | image | `:993` |
  | double quotes | `--hostname` | `:690` |
  | double quotes | `--home` | `:891`, `:998` |
  | double quotes | `--pre-init-hooks` | `:1001` |
  | double quotes | `--additional-packages` | `:1002` |
  | single quotes | init hook | `:1003` |

- `--dry-run` prints the generated command and creates nothing (`:1011`).
- `--clone` refuses a source box that is running (`:619`).
- `distrobox-rm:361` reads the box home from `inspect .Config.Env` (`HOME=`).
  Guessing it from the mounts does not work: the host home and the custom home
  are both mounted, and docker's `.Mounts` has no destinations.
- `rm --force` already implies non-interactive. `stop --yes a b c` works.
  `--unshare-all` exists. `enter`, `stop`, `rm` and `create` all honour
  `DBX_CONTAINER_MANAGER`.
- After `<engine> start`, `distrobox-enter` waits for `container_setup_done`
  (`:708-756`). A bare `podman start` does not, so a box can report *running*
  before it is ready.
- The shell's `ConfirmDialog` defaults to `selectedIndex: 1`, which is Confirm.
- `SearchableDropdown` is a `QQC.Popup`. Qt reparents popups into the overlay,
  so the popup ignores an ancestor `scale:`.
- Podman on this host has no unqualified-search registries, so short image
  names such as `alpine` fail.
- nixarchy-podman builds one state object per surface (`Menu.qml:89`,
  `Panel.qml:33`).

## Design

### 1. Repository layout

| File | Origin | Role |
|---|---|---|
| `manifest.json` | nixarchy-podman shape | Plugin identity, entry points, settings (§2) |
| `qmldir` | new | `singleton DistroboxState 1.0 DistroboxState.qml` |
| `Model.js` | about 40% lifted from podman `Model.js` | All logic, `.pragma library`, Node-tested (§7) |
| `DistroboxState.qml` | cut down from `PodmanState.qml` | The singleton: processes, timers, the operation lock, the log (§3) |
| `DistroboxView.qml` | from `PodmanView.qml`, without tabs, prune or usage | Mode machine, keys, header and footer (§5) |
| `BoxList.qml` | from `ResourceList.qml`, without sections or meters | `ListView`, updated in place with `Model.reconcilePlan` |
| `CreateForm.qml` | new, following nixarchy-pkg `OptionForm.qml` | The create form (§5.3) |
| `LogView.qml` | new, from nixarchy-pkg `Menu.qml:298-321` | Stream log that follows the tail (§4) |
| `ShortcutSheet.qml` | podman, verbatim | The `?` sheet, rendered from `Model.SHORTCUTS` |
| `Menu.qml` | podman, nearly verbatim | Full-screen host, namespace `nixarchy-distrobox-menu`. The `{"create":true}` payload opens the form |
| `Panel.qml` | podman, nearly verbatim | Bar host. IPC target `nixarchy.distrobox.bar` with `open close show hide toggle refresh create stopAll` |
| `share/omarchy-menu.jsonc` | podman shape | Row `apps.distrobox`, with the keys listed in `aliases` |
| `flake.nix`, `flake.lock`, `.github/workflows/ci.yml` | podman, nearly verbatim | Package and checks (§8) |
| `tests/harness.js`, `tests/run.js`, `tests/model/*.test.js` | podman harness | Node tests |
| `README.md`, `docs/usage.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `.github/copilot-instructions.md`, `LICENSE` (MIT) | podman shape | Documentation and agent rules |

There are no tabs, because images are already handled by nixarchy.podman.
`TabStrip.qml`, the stats, prune and usage code, and the podman-tui launcher
are not carried over.

### 2. Manifest

- `id: nixarchy.distrobox` and `schemaVersion: 1`.
- `kinds: ["menu","bar-widget"]` with
  `entryPoints: { menu: Menu.qml, barWidget: Panel.qml }`.
- `keepLoaded: true`.
- `barWidget` has `category: System` and `defaultSection: right`. Its settings:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `refreshIntervalSec` | integer 5–600, step 5 | 30 | How often the bar polls. The open panel polls every 3 s regardless |
| `showStopped` | boolean | true | Off hides stopped boxes |
| `containerManager` | enum `podman`\|`docker` | podman | The engine used for listing, and exported as `DBX_CONTAINER_MANAGER` to every distrobox call |
| `hideWhenEmpty` | boolean | false | Hides the bar glyph while there are no boxes |

### 3. Shared state: the `DistroboxState` singleton

- **One instance** for the bar and the menu. It lives in a directory
  singleton, declared in `qmldir`.
- **Polling by reference count.** Each surface calls `acquire(kind)` when it
  opens and `release(kind)` when it closes (`kind` is `"bar"` or `"view"`).
  - The 3 s list poll runs while any view is open.
  - The `refreshIntervalSec` poll runs while a bar exists.
  - Nothing runs while both are closed.
- **Processes:**
  - `listProcess` runs `Model.listArgv(engine, showStopped)`. It collects
    stdout and stderr, and on exit sets `engineReachable` and `boxes`.
  - `homesProcess` runs `Model.inspectHomesArgv(engine, ids)`, only when the
    set of box ids changes. It fills a cache of homes keyed by id.
  - `actionProcess` runs short mutations: start, stop, restart, remove, stop
    all. It sets `pendingId` and `lastError`.
  - `streamProcess` runs create and upgrade. Stdout and stderr each have a
    `SplitParser` that calls `appendLog`.
  - `copyProcess` runs `wl-copy --trim-newline <name>`.
- **Lock: one mutation at a time.**
  - `mutating` is `actionProcess.running || streamProcess.running`.
  - Every mutation entry point checks it. A refused call sets `lastError` to
    say what is running and that `o` shows it.
  - Listing is never locked.
- **Engine per operation.** The engine is read from settings when an operation
  starts and baked into that operation's argv. It is never re-read while the
  operation runs.
- **Fallback.** If step 4 shows that the plugin loader gives each surface its
  own singleton instance, `Menu.qml` forwards mutations to the bar's IPC target
  instead, and the bar owns the state. Only `Menu.qml` changes; the rest of
  this design stays.

### 4. Readiness and the stream

- **Start** is `env DBX_CONTAINER_MANAGER=<e> distrobox enter -n <name> -T -- true`,
  run as an action. It reuses distrobox's own wait for initialisation. The row
  shows "starting…" until it exits.
- **Restart** is `distrobox stop --yes <name>` followed by the start above.
- **Enter** runs `omarchy-launch-tui --app-id=org.omarchy.distrobox-enter env DBX_CONTAINER_MANAGER=<e> distrobox enter <name>`
  through `Quickshell.execDetached`, and then the surface closes. `enter`
  waits for initialisation itself.
- **Upgrade** is streamed: `env DBX_NON_INTERACTIVE=1 DBX_CONTAINER_MANAGER=<e> distrobox upgrade <name>`,
  or `--all`.
- **Create** is streamed: `Model.createArgv(form, engine)`. The box is created
  but not initialised. The last log line tells the user to press `s` or Enter
  for the first-run setup.
- **Log:**
  - ANSI escapes are stripped (`Model.stripAnsi`).
  - Each line is capped at 2 KB (`Model.capLine`) and the log at 400 lines.
  - Text is rendered as `Text.PlainText`.
  - On exit, the stream writes `── exit <code> · done|failed` and refreshes the
    list.
- **Detaching** only hides `LogView`. The parsers stay attached.
- **Limit:** restarting or reloading the shell kills the stream and its child
  process (decision 5).

### 5. View: modes, keys and look

#### 5.1 Modes

- `mode` is one of `list | form | log`. On top of any mode sit two overlays:
  `helpOpen` and `confirmOpen`.
- The shell's `PanelKeyCatcher` is
  `blocked: filterField.activeFocus || confirmOpen || mode !== "list"`.
- The form and the log are `FocusScope`s that own the keyboard.
- Mode transitions:

| From | Trigger | To |
|---|---|---|
| list | `c`, IPC `create`, or payload `{"create":true}` | form |
| form | Enter, if the form is valid | log (create stream) |
| form | Esc | list |
| list | `g` or `U` | log (upgrade stream) |
| log | Esc | list (the job keeps running) |
| list | `o` | log (while a stream runs, or after one has finished) |

- `reset()` runs on every open:
  - it sets mode to list, clears the filter and the cursor, and closes help,
    confirm and the form;
  - it then schedules `Qt.callLater(focusForMode)`, which focuses whatever
    belongs to the **final** mode: the key catcher, or the form's first field.
    An IPC `create` in the same tick therefore keeps the form's focus;
  - it never touches the stream or the log.
- Confirm dialogs always set `selectedIndex = 0` (Cancel). The parent's
  `Keys.onPressed` hands keys to `confirmDialog.handleKey`, as in
  `PodmanView.qml:213-220`.

#### 5.2 List keys

`PanelKeyCatcher` provides these built-ins:

| Key | Built-in behaviour |
|---|---|
| Esc | close |
| Tab | tabRequested |
| j, k, ↑, ↓ | move |
| Enter, Space | activate |
| x | delete |

All other keys arrive through `textKey`.

| Key | Action |
|---|---|
| j, k, ↑, ↓ | Move. `k` on the first row goes to the filter; ↓ in the filter returns to the list |
| `/` | Focus the filter. Esc clears it, then leaves it |
| Enter, `e` | Enter the box in a terminal |
| `s` | Start the box (waits for initialisation) or stop it |
| `r` | Restart |
| `g` | Upgrade this box (streamed) |
| `U` | Upgrade every box (streamed) |
| `S` | Stop every running box (asks to confirm) |
| `x` | Delete the box (asks to confirm, Cancel by default). The text says "home <path> is kept" |
| `c` | Open the create form |
| `y` | Copy the box name |
| `o` | Show the log |
| `u` | Refresh |
| `?` | Show the shortcut sheet |
| Esc | Step back: the filter, then help, then close |
| Tab | In the bar popup, go to the next panel. Does nothing in the menu |

Mouse buttons on each row come from `Model.actionsFor(row, lock)`: enter,
start or stop, upgrade, remove.

#### 5.3 The create form

- **Navigation.** Tab or ↓ moves to the next field; Shift+Tab or ↑ moves to
  the previous one. `j` and `k` move between fields only when the field under
  the cursor is not a text field, because a text field keeps every printable
  key.
- **Space** flips a toggle, or expands and collapses the Advanced section.
- **Enter** validates, then creates. If validation fails, the errors appear
  under the fields in `Color.urgent` and the form stays open.
- **Esc** cancels. A hint line at the bottom lists the keys for the current
  field.
- **Basic fields:**
  - `name` (required);
  - `image`: a TextField above an inline list of `Model.IMAGES`, filtered by
    what has been typed. ↓ from the field moves into the list, Enter picks an
    entry, Esc goes back to the field. Default:
    `registry.fedoraproject.org/fedora-toolbox:latest`. There is no Popup
    (see Facts);
  - `pull`, `home`, `additionalPackages`, `init`, `nvidia`.
- **Advanced fields (collapsed by default):**
  - `hostname`;
  - `clone`: lists only stopped boxes; when set, the image field is disabled;
  - `volumes`, `additionalFlags`, `initHooks`, `preInitHooks`, `platform`;
  - `unshareAll`, and the five individual `unshare*` toggles, which gray out
    while `unshareAll` is on;
  - `noEntry`.

#### 5.4 Look

Everything here follows nixarchy-podman and nixarchy-pkg.

- **Header.** A `PanelHero` titled "Distrobox", with a summary line such as
  "2 of 3 running" from `Model.summaryText`.
- **Rows** are drawn with `CursorSurface` and contain:
  - a state dot: `Color.accent` when running, a dim outline when stopped,
    `Color.urgent` when the exit code is not 0;
  - the box name, in bold when running;
  - a `shortImage · homeLabel` subtitle;
  - the status text, on stopped rows;
  - action buttons.

  A row dims while its action is pending.
- **Footer**, following nixarchy-pkg `Card.qml:248-346`, from top to bottom:
  - a hairline;
  - a message line: `lastError` in urgent colour, or the stream status in dim
    colour;
  - a three-slot line with `N boxes · M running` on the left and
    `? keys  c create  esc close` on the right, at opacity 0.65.
- **Theming.** Colours come only from `qs.Commons` (`Color`, `Style`,
  `Border`) and widgets only from `qs.Ui`. Dim text is `Qt.darker(fg, 1.5)`.
- **Scale.** The menu keeps podman's `scale: 1.45`, since nothing in it pops
  up.

### 6. Input safety

**Rule 1: argv arrays only.** No command ever goes through `sh -c`.

**Rule 2: validate every field for the context where distrobox places it.**
distrobox runs `eval` on the command it generates. Each field is therefore
checked against an allowlist that suits the quoting context it lands in:

| Field | Host context | Accepted |
|---|---|---|
| name | argv / double quotes | `^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$`, and not the name of an existing box |
| hostname | double quotes | RFC 1123 labels joined by `.`, at most 64 characters |
| image | unquoted | OCI reference: `registry/path[:tag][@sha256:…]`, lowercase path. A name without a registry domain only gets a warning |
| platform | unquoted | `^[a-z0-9]+/[a-z0-9_]+(/[a-z0-9]+)?$` |
| home | double quotes | an absolute path, or one starting with `~/`, using only `[A-Za-z0-9_./~+-]` |
| volumes | unquoted | whitespace-separated `src:dst[:opts]`. Paths use the home character set; `opts` is drawn from `ro rw z Z rslave rshared …` |
| additionalPackages | double quotes | whitespace-separated tokens of `[A-Za-z0-9_.+:@=-]+` |
| additionalFlags | unquoted | whitespace-separated tokens matching `^--?[A-Za-z0-9][A-Za-z0-9-]*(=[A-Za-z0-9_./:@,+=-]*)?$` |
| preInitHooks | double quotes | free text, but none of `" \ $ \`` and no control characters. So pre-init hooks cannot use `$VAR` (documented) |
| initHooks | single quotes | free text, but no `'` and no control characters |
| clone | argv | the name of an existing box that is stopped |

- `validateForm(form, boxes)` returns `{ ok, errors: {field: text}, warnings: {field: text} }`.
- `createArgv` returns `null` whenever validation fails.
- **Proof.** Step 7 of the plan feeds a table of hostile samples through the
  real form into `distrobox create --dry-run` and checks that each one appears
  in the printed command only as inert text.

### 7. Model.js API

The module is `.pragma library`. Pure functions, no QML.

- **Validators:** `isBoxName`, `isHostname`, `isImageRef`, `isShortName`,
  `isPlatform`, `isPath`, `isVolumeSpec`, `isPackageList`, `isFlagList`,
  `isPreInitHook`, `isInitHook`.
- **Parsing:**
  - `parseJsonLines`, verbatim from podman;
  - `normalizeName`: takes the first comma-separated name, strips a leading `/`,
    then validates;
  - `normalizeBox`, `normalizeBoxes`: accept both podman-shaped and
    docker-shaped rows;
  - `parseHomes(text)` returns a map from id to home;
  - `homeLabel(home, hostHome)`.
- **List helpers:**
  - `counts`, `summaryText`, `emptyText(state)`, `errorText`;
  - `filterBoxes`, and `sortBoxes`, which orders running boxes first, then
    failing ones, then by name;
  - `rowsFor`, `rowRecord`, `ROW_FIELDS`, `reconcilePlan`, `clampCursor`, all
    from podman;
  - `actionsFor(row, lock)`.
- **Commands.** Each takes the engine explicitly and returns an argv array, or
  `null` on invalid input. Every distrobox command starts with
  `env DBX_CONTAINER_MANAGER=<engine>`.
  - `engineFor(v)` returns `"docker"` only when `v === "docker"`, and
    `"podman"` otherwise;
  - `listArgv`, `inspectHomesArgv`, `enterArgv`, `startArgv`, `stopArgv`,
    `restartArgv`, `removeArgv`, `upgradeArgv`, `createArgv`.
- **Form:** `emptyForm`, `validateForm`, `formSummary`.
- **Text:** `stripAnsi`, `capLine`, `removeMessage`, `stopAllMessage`.
- **Constants:**
  - `IMAGES`: about 12 fully qualified toolbox images;
  - `DEFAULT_IMAGE`, `BOX_FORMAT`;
  - `SHORTCUTS` and `shortcutGroups`;
  - `Glyph`.
- **Settings:** `settingsFor`, verbatim from podman.

`BOX_FORMAT` is
`{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}}}`.

### 8. Packaging and checks

- The package is `pkgs.runCommand` that copies an explicit `files` list as real
  files (runtime files only):
  - `manifest.json`, `qmldir`, `LICENSE`, `Model.js`;
  - `Panel.qml`, `Menu.qml`;
  - `DistroboxState.qml`, `DistroboxView.qml`;
  - `BoxList.qml`, `CreateForm.qml`, `LogView.qml`, `ShortcutSheet.qml`.
- The only input is `nixpkgs`. There is no Home Manager or NixOS module.
  Consumers set `programs.nixarchy.plugins."nixarchy.distrobox".src`.
- `checks.default` fails on any of these:
  - `node tests/run.js` fails;
  - jq finds the manifest's id, kinds or entry points wrong;
  - an entry point is missing from the package;
  - the package contains a symlink;
  - `pacman` or `yay` appears anywhere;
  - a `"#hex"` literal appears in QML.
- CI runs `nix flake check`, `nix flake check --all-systems --no-build`,
  `nix build`, and the no-symlink check.

## Alternatives rejected

- **Parsing `distrobox list` text.** Its layout is not stable, it is coloured
  on a TTY, and it is only `ps` underneath.
- **Tabs for boxes and images.** nixarchy.podman already has the images tab.
  Copying it would duplicate about 300 lines of Model code.
- **One state object per surface (podman's layout).** It cannot enforce one
  mutation at a time, and a log started in the menu would be invisible from
  the bar.
- **`<engine> start` for Start.** It returns before distrobox has finished
  initialising, so Enter or upgrade would race the first-run setup.
- **Reading the home directory from `.Mounts`.** Ambiguous (see Facts).
- **Blocking a list of shell metacharacters.** Not enough, because redirections,
  quotes and expansions still get through the host `eval`.
- **Splitting `--additional-flags` in QML.** distrobox already evals the value.
  Validating tokens is enough.
- **`SearchableDropdown` for the image.** Its Popup ignores the menu's scale.
- **An adapter script that prints JSON** (nixarchy-pkg's approach). Quickshell
  gives us the exit code directly, so the extra tool on `PATH` buys nothing.
- **Auto-detecting the engine, `--root` boxes, `--rm-home`.** Declined by the
  owner for v1.

## Risks

- **The loader may not share a directory singleton between the two surfaces.**
  Found by the step 4 test; the fallback is IPC forwarding (§3).
- **Allowlists may reject legitimate input.** Examples: paths with spaces, and
  `$VAR` in pre-init hooks. Both are documented, and the error text names the
  characters that are allowed.
- **Differences between podman and docker output.** `Names` is a comma list on
  docker, and the list of states differs. Both shapes have test fixtures.
- **A keepLoaded surface can keep focus it should have released.** A TextField
  that still has focus swallows the next open's keys. `reset()` calls
  `focusForMode` through `Qt.callLater`. Checked live in steps 5 and 8.
- **A create can take minutes.** It survives Esc and closing the surface, but
  not a shell restart (decision 5).
- **Hosts:** the change only affects p620 and razer once they add the flake
  input, which is a separate change. Nothing changes system-wide.

## Out of scope

- `--rm-home` and `--root`.
- Auto-detecting the engine.
- `generate-entry` and `distrobox-export`.
- Volume paths with spaces.
- `distrobox assemble`.
- A stream that survives a shell restart.
- Wiring the host flake.

## Verification

- **Node:** `node tests/run.js` runs five files:
  - `parsing`: podman and docker fixtures, name normalisation, homes;
  - `rows`;
  - `commands`: every argv is an array, carries the engine prefix, and is
    `null` on bad input;
  - `form`: an allowlist table of good and hostile samples for each field, the
    clone source being stopped, unshare-all, and a full round-trip;
  - `settings`.
- **Nix:** `nix flake check` and `nix flake check --all-systems --no-build`
  pass. `nix build` contains exactly the runtime files. `omarchy plugin
  validate "$(readlink -f result)"` passes. A planted hex colour, symlink or
  `pacman` makes the check fail (reverted afterwards).
- **Injection proof:** each hostile sample, run through
  `distrobox create --dry-run`, is printed as inert text.
- **Live**, after `omarchy-restart-shell`, `omarchy-shell shell ping`, and a
  clean `qs log`:
  - the bar counts are right, and `hideWhenEmpty` works;
  - every key works once in the popup and once in the menu;
  - a mutation started in one surface is refused in the other;
  - `toggle '{"create":true}'` leaves the form with focus;
  - a create done entirely from the keyboard, using Advanced fields, matches
    `podman inspect`;
  - Start shows "starting…" until initialisation finishes, and Enter then opens
    a shell straight away;
  - a stream keeps running after Esc and after the surface closes;
  - delete keeps the home directory;
  - only the bar's slow poll runs while everything is closed;
  - with `containerManager: docker`, a process listing during an operation shows
    `DBX_CONTAINER_MANAGER=docker` for enter, stop and rm.
