---
status: draft
issue: 8
spec: spec/2026-09-18-8-assemble-templates.md
---

# Plan: templates of your own, from a distrobox assemble file

## Approved decisions (self-contained summary)

- **The plugin never runs `distrobox assemble`.** distrobox 1.8.2.5 writes each
  `key=value` into a temp file and sources it as shell, so an unquoted `$(…)`
  value runs on the host just from being read. The plugin parses the file itself,
  in JavaScript, and creates only through the form's validated `createArgv`.
- **The setting `templatesFile`** (string, default
  `~/.config/distrobox/boxes.ini`) must pass `isPath`, or the default is used.
  The file is read with `FileView`, watched, never written, and capped at
  64 KB. A missing file means an empty list.
- **`Model.parseAssemble(text)`** mirrors `parse_file`:
  - tabs become spaces;
  - drop `#` lines, ` #…` inline comments, and `#` after `]`;
  - trim the end, and skip empty lines;
  - `[name]` headers, with `][ ` removed;
  - the key is before the first `=`, with spaces removed; the value is after
    it;
  - true/false become 1/0, and one pair of surrounding quotes is stripped;
  - repeated keys accumulate.
- **`Model.resolveSection(parsed, name)`** mirrors `resolve_includes`: it inlines
  `include=X` in place, with a chain per section (a repeat is an error, a
  missing section is an error), a depth of 8, and 256 lines at most.
- **`Model.sectionToForm(lines)`** maps the create keys onto `emptyForm()` with
  `template: "file:<name>"`.
  - Volumes and packages are space-joined. Hooks are joined with `; ` unless a
    part already ends in `;` or `&&`. `entry=0` means `noEntry`.
  - **Refused, with a reason:** `exported_apps`, `exported_bins`,
    `exported_bins_path`, `root=1`, `replace=1`, and any unknown key.
  - **Noted and ignored:** `start_now`, `name`.
- **`Model.fileTemplates(text)`** returns `[{id, label, form, usable, reasons}]`.
  An entry is usable only if it resolves, nothing is refused, and `validateForm`
  accepts it apart from the name being taken.
- **The "Start from" list** gains **Yours** after the built-ins.
  - Unusable entries are dimmed, and picking one shows its reasons in
    `Color.urgent` and changes nothing.
  - Picking a usable one sets the form: a name already typed is kept; otherwise
    the section name fills it.
- **Depends on #7** (the "Start from" list); the branch rebases after #7 merges.

## Steps

Each step is one commit on `feat/8-assemble-templates`, citing `plan step N`. A
deviation updates this file in the same commit.

1. **Rebase onto `main` once #7 is merged.**
   → Verify: `node tests/run.js` passes, and `Model.templateChoices` exists.
2. **`Model.js`:** `parseAssemble`, `resolveSection`, `sectionToForm`,
   `fileTemplates`, and `templateChoices` with the "Yours" group. New
   `tests/model/assemble.test.js` covers:
   - **the line rules,** each case taken from `parse_file`;
   - **cumulative keys:** volume ×2, packages ×2, and hooks with and without a
     trailing `;` or `&&`;
   - **include:** simple, nested, circular, missing, and over-depth;
   - **refused and noted keys;**
   - **hostile values in every key:** `$(id)`, a backtick, `;` in the image,
     and `'` in `init_hooks`. Each is unusable, with the raw text untouched;
   - **a two-box file** like the owner's fedora and ubuntu wrappers, both
     usable with the forms expected;
   - **the 64 KB and 256-line bounds.**

   → Verify: `node tests/run.js` passes.
3. **`manifest.json`, `settingsFor`, `DistroboxState.qml` (`FileView`,
   `userTemplates`) and `CreateForm.qml`** (the Yours group, the dimmed entries,
   and the reasons shown).
   → Verify: `nix flake check` passes, 12 package files, and the manifest jq
   check passes.
4. **Live checks, in the popup and the menu.** The same discipline as #7 (ask
   the owner, announce on the bus, `demo-*` boxes, ownership guard, teardown and
   snapshot diff).
   - **Setup:** write a `boxes.ini` with `demo-file-a` (usable), `demo-file-b`
     (usable, using `include`) and `demo-file-x` (with `exported_apps`) at the
     setting's path, backing up any existing file.
   - **The checks:**
     1. "Yours" lists all three, with `demo-file-x` dimmed.
     2. Picking `demo-file-x` shows its reason and changes nothing.
     3. Picking `demo-file-a` fills the form; create it, and `podman inspect`
        matches the file.
     4. `demo-file-b`'s included values appear.
     5. Editing the file updates the list with no restart.
   - **Afterwards:** restore or remove the file, and tear down.

   → Verify: every result is recorded.
5. **Docs:**
   - `usage.md` gets "Your own templates": the format, an example, what is
     refused, the setting, and a note that the plugin never runs
     `distrobox assemble`;
   - Troubleshooting gets "listed but greyed out";
   - the README settings table gets the new setting.

   → Verify: the site link check passes.
6. **PR** (`Closes #8`) linking the artifacts. Merge once CI is green.
   → Verify: merged, and on `origin/main`.
7. **Host update:** a lock bump, the same procedure as #4's plan step 5 (it can
   be combined with #7's).
   → Verify: the new rev is on both hosts, 0 failed units, and other agents'
   changes are untouched.

**The Home Manager `boxes.ini` generator** in nixos_config is a separate change,
not in this plan.

## Tests

- **A.** `node tests/run.js`.
- **B.** `nix flake check`, 12 package files.
- **C.** Live checks 1–5, both surfaces.
- **D.** The site link check.
- **E.** Host end-state checks.

## Rollback

- **Before merge:** close the PR.
- **After merge:** `git revert`.
- **Hosts:** revert the lock bump, or `nixos-rebuild switch --rollback`.
- **The test `boxes.ini`:** restored from its backup, or removed. The
  `demo-file-*` boxes are removed by teardown.

## Implementation record

### Deviations

_None yet._

### Test results

_Pending._
