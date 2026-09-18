# nixarchy.distrobox

[distrobox](https://distrobox.it/) for [Omarchy](https://omarchy.org/) on NixOS, on
the bar and on a key. Every box with its image and home directory. Enter one in a
terminal, start, stop, restart, upgrade or delete it. Create a new one from a
form that knows every `distrobox create` flag. Create and upgrade stream their
output into the panel, so a multi-minute image pull or package upgrade doesn't
tie up a terminal.

The whole thing runs from the keyboard and follows your Omarchy theme. It comes
in two forms:

- **a bar widget**, whose popup opens under the glyph;
- **a full-screen menu** on a key or an Omarchy menu row.

Both share one state, so a job started in one is visible, and locked, in the
other.

**See it working:** <https://olafkfreund.github.io/nixarchy-distrobox/>, with real
screenshots and recordings. The walkthrough, from install to troubleshooting, is
[`docs/usage.md`](docs/usage.md), which is also
[on the site](https://olafkfreund.github.io/nixarchy-distrobox/usage/).

## What it does

- **Lists your real boxes.** It asks the container engine directly for
  everything labelled `manager=distrobox`, because `distrobox list` has no
  machine-readable output. Running boxes come first. A box that failed shows
  red. A box you stopped shows as *Stopped*, not as an error. Each row shows
  the image and the home directory (`~` when the box shares yours).
- **Starts a box properly.** Start waits for distrobox's own first-run setup
  (`distrobox enter -T -- true`) instead of returning while the box is still
  installing its packages, so Enter afterwards drops straight into a shell.
- **Creates from a form.** The common fields come first: name, image (picked
  from a list of fully qualified toolbox images, or typed), home, extra
  packages, init and NVIDIA. Everything else sits behind Advanced: hostname,
  clone, volumes, engine flags, init and pre-init hooks, platform, the six
  `--unshare-*` switches and `--no-entry`. Bad input is flagged inline before
  anything runs.
- **Streams create and upgrade** into a log in the panel. Esc hides the log
  and the job keeps running; `o` brings it back.
- **One change at a time.** While a start, stop, delete, create or upgrade
  runs, every other change is refused with a reason, from either surface.

## Keyboard

The same list is on the `?` sheet inside the panel (`Model.SHORTCUTS`).

### The list

| Key | Does |
| --- | --- |
| `j` `k` `↑` `↓` | Move the cursor down / up |
| `/` | Jump into the filter box |
| `k` `↑` | From the first row, step back up into the filter |
| `enter` `e` | Enter the box in a terminal |
| `s` | Start it (waits for its setup) or stop it |
| `r` | Restart it |
| `g` | Upgrade its packages, with the log in the panel |
| `x` | Delete it (its home directory is kept) |
| `y` | Copy its name |
| `c` | Create a new box |
| `U` | Upgrade every box |
| `S` | Stop every running box |
| `o` | Show the create / upgrade log |
| `u` | Refresh now |
| `?` | Show this list |
| `esc` | Leave the filter, then close the panel |

### The create form

| Key | Does |
| --- | --- |
| `tab` `↓` / `shift+tab` `↑` | Next / previous field |
| `↓` on Start from | Into the template list; type to filter, `enter` picks, `esc` goes back |
| `↓` on Image | Into the image list; `enter` picks, `esc` goes back |
| `space` | Flip a switch, open Advanced, cycle the clone source |
| `j` `k` | Move between switch rows (in a text field they type) |
| `enter` | Create the box |
| `esc` | Cancel |

### The log

| Key | Does |
| --- | --- |
| `j` `k` | Scroll (stops following) |
| `G` `end` | Jump to the end and follow |
| `esc` | Back to the list; the job keeps running |

## Installation

Requirements, all on `PATH`:
- `distrobox`;
- `podman` or `docker`;
- `omarchy-launch-tui` and `wl-copy`, which Omarchy ships.

### NixOS (nixarchy)

```nix
# flake.nix
inputs.nixarchy-distrobox = {
  url = "github:olafkfreund/nixarchy-distrobox";
  inputs.nixpkgs.follows = "nixpkgs";
};

# your Home Manager config
programs.nixarchy.plugins."nixarchy.distrobox".src =
  inputs.nixarchy-distrobox.packages.${pkgs.stdenv.hostPlatform.system}.default;
```

Rebuild, then enable it once: `omarchy plugin enable nixarchy.distrobox`.

### Without Nix

```bash
omarchy plugin add https://github.com/olafkfreund/nixarchy-distrobox
omarchy plugin enable nixarchy.distrobox
```

### The menu and a key

```bash
omarchy-shell shell toggle nixarchy.distrobox '{}'
omarchy-shell shell toggle nixarchy.distrobox '{"create":true}'   # straight into the form
```

To bind it in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + ALT + D", "Distrobox", "omarchy-shell shell toggle nixarchy.distrobox '{}'")
```

For an Omarchy menu row, paste [`share/omarchy-menu.jsonc`](share/omarchy-menu.jsonc)
into `~/.config/omarchy/extensions/omarchy-menu.jsonc`.

## Settings

Set these in the bar widget's settings (Super+Alt+B), or inline on its entry in
`~/.config/omarchy/shell.json`. The menu reads the same entry.

| Key | Default | Meaning |
| --- | --- | --- |
| `refreshIntervalSec` | `30` | How often the bar glyph polls. An open panel polls every 3 s regardless. Nothing polls while every surface is closed and no bar shows the widget. |
| `showStopped` | `true` | Off lists only running boxes. |
| `containerManager` | `podman` | `podman` or `docker`. The list is read from this engine, and every distrobox command runs with `DBX_CONTAINER_MANAGER` set to it. |
| `hideWhenEmpty` | `false` | Hide the bar glyph while there are no boxes. |
| `templatesFile` | `~/.config/distrobox/boxes.ini` | A `distrobox assemble` file whose sections appear under **Start from** as your own templates. Read, never run. |

## IPC

The bar widget answers on the target `nixarchy.distrobox.bar`:

```bash
omarchy shell nixarchy.distrobox.bar open|close|show|hide|toggle
omarchy shell nixarchy.distrobox.bar refresh
omarchy shell nixarchy.distrobox.bar create        # opens the popup on the form
omarchy shell nixarchy.distrobox.bar stopAll
omarchy shell nixarchy.distrobox.bar start <name>
omarchy shell nixarchy.distrobox.bar status        # JSON: lock, stream, boxes
```

The menu has the same `status` hook:
`omarchy-shell shell call nixarchy.distrobox status ''`.

## Safety

`distrobox create` builds one command string and runs it through `eval` on your
host. Each form field lands somewhere different in that string: unquoted,
inside `"…"`, or inside `'…'`. So the plugin never passes user input through a
shell. Every command is an argv array, and every create field is checked
against an allowlist for the spot it lands in before anything runs.

This was tested live against a real `create`:
- Hooks full of `;`, `&&`, `|`, `$( … )` and backticks ran nothing on the
  host.
- A single `'` in an init hook, sent by bypassing the validator, did run on the
  host. The form refuses exactly that.

## Development

```bash
node tests/run.js                              # Model tests
nix flake check                                # tests + manifest, singleton, no symlinks, no pacman/yay, no hex colours
nix flake check --all-systems --no-build
nix build && omarchy plugin validate "$(readlink -f result)"
```

The rules for changing anything here are in [`AGENTS.md`](AGENTS.md). The design
for each change is in `intent/`, `spec/` and `plan/`.

## License

MIT.
