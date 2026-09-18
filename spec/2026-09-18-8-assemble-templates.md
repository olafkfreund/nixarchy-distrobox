---
status: approved
issue: 8
intent: intent/2026-09-18-8-assemble-templates.md
---

# Spec: templates of your own, from a distrobox assemble file

## Decisions taken from the intent's open questions

The owner approved the intent with its defaults:

1. **A setting,** `templatesFile`, with the default
   `~/.config/distrobox/boxes.ini`.
2. **Refuse the `exported_apps`, `exported_bins` and `exported_bins_path` keys in
   v1.** A section that uses them is listed, marked, and cannot be applied.
3. **Create through the form:** apply the section to the form, then create
   through the plugin's own validated `createArgv`. The plugin never runs
   `distrobox assemble`.

## Facts this design rests on (read in `distrobox-assemble`, 1.8.2.5)

- **`distrobox assemble` sources the file as shell.** `parse_file` writes every
  `key=value` into a temp file that is later sourced with `.`. A value without
  spaces is written unquoted, so `image=$(any command)` runs on the host the
  moment `distrobox assemble` reads the file, before any create.
  - `sanitize_variable` only adds quotes around values that contain spaces.
  - Hooks are base64-encoded first, but everything else is not.
  - So decision 3 is not only simpler, it is the safe choice: **the plugin
    parses the file itself, in JavaScript, and never passes it to distrobox.**
- **How lines are read:**
  - Tabs become spaces.
  - A line starting `#` is dropped, and so is anything from ` #` (space then
    hash) to the end of the line; for a section header, anything after `]` that
    contains `#`.
  - Trailing whitespace is trimmed, and empty lines are skipped.
  - `[name]` starts a section (all `]`, `[` and spaces removed from the name).
  - Otherwise, the key is everything before the first `=`, with spaces removed;
    the value is everything after it.
- **How values are read:**
  - `true` and `false` become `1` and `0`.
  - One pair of surrounding quotes, `"…"` or `'…'`, is removed, which is what
    sourcing does.
  - **A repeated key is cumulative.** Values are joined with `¤`, and the
    command builder then treats each part separately: every `volume`, every
    package list, and every hook (joined with `; ` unless it already ends in
    `;` or `&&`).
- **How `include` works** (`resolve_includes`): an `include=X` line is replaced
  **in place** by the lines of section `[X]`. Including a section already on
  the current include chain is a "circular reference" error, and a missing
  section is an error. The chain resets at every section header.
- **How the create flags map:**
  - `image`, `clone`, `home`, `hostname` and `volume` (cumulative) map to their
    create flags. So do `additional_packages` (cumulative, space-joined),
    `additional_flags`, `init_hooks` and `pre_init_hooks` (cumulative, joined as
    above), and `platform`.
  - `init`, `pull` and `nvidia` are 1 or 0.
  - `entry=0` means `--no-entry`, and `unshare_*` are 1 or 0.
  - `root=1` means a rootful box.
  - `start_now=1` runs `distrobox enter -- touch /dev/null` after the create.
  - `replace=1` deletes an existing box of the same name first.
  - `exported_apps` and `exported_bins` run `distrobox-export` inside the box.

## Design

### 1. `Model.js`: parse, resolve, map (pure, Node-tested)

- **`parseAssemble(text)`** returns `{ sections: [{name, lines: [{key, value}]}], errors: [...] }`.
  - It follows the line rules above exactly.
  - It keeps each line's key and raw value. Nothing is quoted, sourced or
    evaluated; the input is text.
  - Section names go through `isBoxName`. An invalid name is kept, flagged with
    an error, and cannot be applied.
- **`resolveSection(parsed, name)`** returns the section's lines, with every
  `include` inlined per `resolve_includes`.
  - It keeps a chain per section, and is bounded: a depth of 8 and 256 lines.
  - A circular reference, a missing section, or going past the bounds returns
    `{error}` and no lines.
- **`sectionToForm(lines)`** returns `{ form, refused: [key, …], notes: [...] }`.
  - It starts from `emptyForm()`, with `template: "file:<name>"`.
  - It applies each key as mapped above: quotes stripped once, true/false read
    as 1/0, repeated keys accumulated the way distrobox does. Volumes and
    packages are space-joined; hooks are joined with `; ` unless the part already
    ends in `;` or `&&`.
  - **It refuses, with reasons** (the section cannot be applied):
    - `exported_apps`, `exported_bins`, `exported_bins_path` (decision 2);
    - `root=1` (rootful boxes are out of scope for the plugin, as in #1);
    - `replace=1` (it deletes an existing box, a destructive step the form never
      takes);
    - any unknown key, rather than silently ignoring it.
  - **It notes, and ignores:** `start_now` (the form does not start boxes after
    create; the list's `s` does), and a `name=` key (the section header is the
    name).
- **`fileTemplates(text)`** returns the list the form shows:
  `[{id, label, form, usable, reasons}]`, one entry per section.
  - An entry is **usable** only if it resolves, nothing is refused, and
    `validateForm(form, [])` accepts it apart from the name being taken.
  - Every value therefore passes the same per-field allowlists as typed input.
- **`templateChoices(query, fileTemplates)`** (from #7) gains the "Yours" group,
  after the built-ins. Unusable entries are listed and dimmed, with their first
  reason.

### 2. `DistroboxState.qml`: read the file

- A `FileView` on `Model.expandHome(settings.templatesFile, hostHome)` (the same
  expansion as the form's home field), with its `path` watched. The file is only
  read, never written.
- Its text goes through `Model.fileTemplates()` and into a `userTemplates`
  property. A missing file means an empty list, and no error.
- Read on open and when the file changes; not polled.

### 3. Settings

- **`manifest.json`** gains
  `{ key: "templatesFile", type: "string", label: "Your templates", default "~/.config/distrobox/boxes.ini" }`,
  a type other installed plugins already use.
- **`settingsFor`** passes it through.
- **Only paths are accepted:** the path must pass `isPath` (absolute, or `~/`,
  and no spaces or quotes); anything else falls back to the default.

### 4. `CreateForm.qml`

"Start from" shows two groups: **Built-in** and **Yours**.

- **Picking a usable file template** sets `root.form` to its form, with the name
  kept if the user already typed one; otherwise the section name fills Name.
- **Picking an unusable one** does nothing, and shows its reasons under the
  field in `Color.urgent`.

### 5. Docs

- **`usage.md`:** "Your own templates", with the file format, a two-box example,
  and what is refused and why.
- **Troubleshooting:** "A template is listed but greyed out" lists the reasons
  and names the setting.
- **The nixos_config follow-up** (Home Manager writing `boxes.ini`) is noted but
  not done here.

## Alternatives rejected

- **Running `distrobox assemble create --file …`.** It sources the file as shell
  on the host (see Facts); a template file must never be able to run code by
  being read.
- **A different template format of our own** (TOML, JSON). The point is that the
  same file works with `distrobox assemble` from a terminal.
- **Silently ignoring unknown or refused keys.** The box would differ from what
  the file says, with no sign of it.
- **Supporting `exported_*` in v1.** Declined (decision 2).

## Risks

- **The parser drifting from distrobox's.** Mitigation: the Node tests take
  their cases from `parse_file` and `resolve_includes` (comments, inline `#`,
  quotes, cumulative keys, true/false, and include chains), and the spec cites
  the version.
- **A hostile file.** Only the plugin's parser reads it, no value is evaluated,
  and every value must pass `validateForm` before anything can run. Node tests
  feed hostile `.ini` samples, and check the entries come out unusable or with
  their values untouched.
- **A huge or pathological file.** Bounded: at most 64 KB read, 256 lines per
  resolved section, include depth 8.
- **Deleting a template file mid-session.** `FileView` reports it missing, and
  the list empties.

## Verification

- **Node** (`tests/model/assemble.test.js`):
  - **Parsing:** comments (`#` at line start, ` #` inline, after `]`), tabs,
    trailing spaces, empty lines, keys with spaces, `=` inside a value, one
    pair of quotes stripped, and true/false.
  - **Cumulative keys:** `volume` ×2, `additional_packages` ×2, and hooks joined
    with and without a trailing `;` or `&&`.
  - **`include`:** a simple include, a nested one, a circular reference (an
    error), a missing section (an error), and over-depth.
  - **Refused keys:** `exported_apps`, `exported_bins`, `root=1`, `replace=1`,
    and an unknown key (each unusable, with a reason). `start_now` and `name`
    are noted and ignored.
  - **Hostile values in every key:** `$(id)`, a backtick, `;` in the image, and
    `'` in `init_hooks`. Each is unusable through `validateForm`, and the raw
    text is never altered.
  - **A realistic two-box file** mirroring the owner's fedora and ubuntu
    wrappers, both usable, with the forms expected.
- **Live:**
  - Put a `boxes.ini` (two usable boxes and one refused) at the setting's path.
  - "Start from" shows **Yours**, with the refused entry dimmed and its reason
    shown on pick.
  - Picking a usable one fills the form, and a create matches `podman inspect`.
  - Editing the file updates the list with no restart.
  - The file is removed afterwards.
- `nix flake check` passes, and the package is still 12 files.
