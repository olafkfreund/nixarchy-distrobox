# AGENTS.md

Instructions for any AI agent working in this repository: Claude Code, Codex, Copilot,
Gemini or others. `CLAUDE.md` and `.github/copilot-instructions.md` point here. This
file is the single source. When anything disagrees with it, this file wins.

## What this repository is

`nixarchy.distrobox` is an [Omarchy](https://omarchy.org/) shell plugin written in
Quickshell QML. It manages [distrobox](https://distrobox.it/) containers through two
surfaces:

- **a bar widget**, whose popup sits under the glyph (`Panel.qml`);
- **a full-screen keyboard menu** (`Menu.qml`).

It lists boxes and can:

- create a box from a form that covers every `distrobox create` flag;
- enter, start, stop, restart, upgrade or delete a box.

Create and upgrade stream their output into the panel.

`flake.nix` packages the plugin for NixOS and nixarchy. The user guide is
[`docs/usage.md`](docs/usage.md). The design is in `intent/`, `spec/` and `plan/`.

## Layout

| Path | Owns |
| --- | --- |
| `Model.js` | All logic: parsing engine output, rows, validation, and every command's argv. Pure `.pragma library` with no QML, tested under Node. |
| `qmldir` | Declares `DistroboxState` a singleton, so the bar and the menu share one instance. |
| `DistroboxState.qml` | Data, polling, the operation lock, the stream log, and every `Process`. |
| `DistroboxView.qml` | Interaction: modes (list / form / log), cursor, filter, confirmations, keys. Shared by both surfaces. |
| `BoxList.qml`, `CreateForm.qml`, `LogView.qml`, `ShortcutSheet.qml` | Drawing pieces used by the view. |
| `Panel.qml` | The bar widget host: glyph, `KeyboardPanel` popup, and IPC target `nixarchy.distrobox.bar`. |
| `Menu.qml` | The full-screen menu host (manifest kind `menu`). It scales the view 1.45×. |
| `manifest.json` | Plugin id `nixarchy.distrobox`, kinds `menu` + `bar-widget`, `keepLoaded: true`, settings schema. |
| `flake.nix` | The package (an explicit `files` list, copied as real files) and `checks.<system>.default`. |
| `share/omarchy-menu.jsonc` | The Omarchy menu row users paste in. |
| `tests/` | Node tests for `Model.js` (`tests/run.js`). |
| `intent/`, `spec/`, `plan/` | Design artifacts for each task. See Workflow. |

## Commands

```bash
node tests/run.js                              # Model tests
nix flake check                                # tests + manifest, entry points, no symlinks, no pacman/yay, no hex colours
nix flake check --all-systems --no-build       # aarch64 evaluates
nix build                                      # the plugin folder, exactly as nixarchy links it
omarchy plugin validate "$(readlink -f result)"
```

To see the repo the way `omarchy plugin add` would, validate a fresh clone rather than
the working tree. The `result` link that `nix build` leaves behind is a symlink, so
validating `.` fails once you have built:

```bash
d=$(mktemp -d) && git clone -q . "$d/p" && rm -rf "$d/p/.git" && omarchy plugin validate "$d/p"
```

## Verifying live (on a nixarchy desktop)

1. **Install a copy** (a symlinked checkout does not reload on `rescanPlugins`):
   ```bash
   rm -rf ~/.config/omarchy/plugins/nixarchy.distrobox
   cp -rL result ~/.config/omarchy/plugins/nixarchy.distrobox
   chmod -R u+w ~/.config/omarchy/plugins/nixarchy.distrobox
   ```
   Then enable it once: `omarchy plugin enable nixarchy.distrobox`.
2. **Restart the shell** with `omarchy-restart-shell`, then wait until
   `omarchy-shell shell ping` answers.
3. **Check the log for errors.** Get the instance from `qs list --all`, then run
   `qs log -i <instance>`.
4. **Open each surface:**
   - the menu: `omarchy-shell shell toggle nixarchy.distrobox '{}'`, or
     `'{"create":true}'` to open straight into the form;
   - the popup: `omarchy shell nixarchy.distrobox.bar open`.
5. **Confirm what is up** with `hyprctl layers -j`. The menu's namespace is
   `nixarchy-distrobox-menu`.
6. **Test boxes:** name them `t1`, `t2` and so on, and remove them with
   `distrobox rm` when done.

## Rules

Each rule records a real failure or a hard constraint:

- **No symlinks anywhere in the repository.** `omarchy plugin add` clones this repo
  *as* the plugin folder, and `omarchy-plugin-validate` refuses any symlink inside
  it. That is why `CLAUDE.md` imports `AGENTS.md` instead of linking to it.
- **No hardcoded colours.** Use `Color.*`, `Style.*` and `Border.*` tokens, so themes
  switch cleanly. `nix flake check` fails on `"#rrggbb"`.
- **No `pacman` or `yay`**, not even in comments. nixarchy fails the rebuild on them.
- **A new runtime file goes in the `files` list in `flake.nix`**, or it is not in
  the package.
- **Run external commands by name from `PATH`.** Never wrap or bundle them. A
  missing command fails silently inside a QML `Process`, so document it as a
  requirement.
- **Argv arrays only, never `sh -c`.** Every command is built in `Model.js` as an
  array and returns `null` on invalid input.
- **Every form field is allowlisted for its host quoting context.**
  `distrobox-create` runs `eval ${cmd}` on the host. Some fields land unquoted,
  some inside `"…"` and some inside `'…'`. So one argv element per field does not
  protect the host. `Model.validateForm` owns the rules. Any new field needs its
  own rule and a hostile-input test row.
- **Every distrobox argv starts with `env DBX_CONTAINER_MANAGER=<engine>`.** The
  engine is captured when the operation starts. Without it, a docker user's stop
  or delete can hit a podman box with the same name.
- **One mutation at a time, via the singleton.** Start, stop, restart, remove,
  create and upgrade are refused while another mutation runs, from either
  surface. Listing never locks.
- **Start is `distrobox enter -T -- true`, not `<engine> start`.** A box that
  `ps` reports as running may not have finished its first-run setup yet.
- **Lists read through a QObject `var` property are Qt sequence wrappers, not JS
  arrays.** Check `length`, not `Array.isArray` (see `Model.settingsFor`).
- **The surfaces are keep-loaded.** `open()` resets the view and then focuses
  whatever belongs to the *final* mode, via `Qt.callLater`. It never touches the
  stream or the log.
- **Nothing polls while every surface is closed.** The bar's slow poll for the
  glyph is the only exception.
- **Logic goes in `Model.js`, with a Node test.** Keep QML to drawing and wiring.
- **A user-visible change updates `docs/usage.md` and the README in the same PR.**

## Workflow

Any task that is tracked as an issue, or that touches more than one file, goes
through three artifacts named with the slug `YYYY-MM-DD-<issue>-<slug>`. Typos,
lock bumps and one-line config changes are exempt.

1. `intent/<slug>.md` (why), committed as `status: draft`. Stop for the owner's
   review.
2. After approval, `spec/<slug>.md` (what). Stop.
3. After approval, `plan/<slug>.md` (how, self-contained). Stop.
4. Implement only once the plan is `status: approved`.

- Never approve an artifact yourself.
- Record each approval as its own commit, for example
  `docs(plan): approve <slug> (#N)`.
- Make one commit per plan step, and cite the step.
- If the work deviates from the plan, update `plan/` in the same commit as the
  code.
- The PR links all three artifacts and closes the issue. Review compares the diff
  to `plan/`.

Branches are named `feat|fix|docs/<issue>-<slug>`. Commit subjects use Conventional
Commits (`feat:`, `fix:`, `docs:`, `build:`, `ci:`, `refactor:`), each with the
issue number.

## Known follow-ups

- `--rm-home` on delete, and `--root` boxes.
- Wire p620 and razer to this flake.
