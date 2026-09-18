---
status: approved
issue: 7
spec: spec/2026-09-18-7-distro-templates.md
---

# Plan: distro templates, a "Start from" list in the create form

## Approved decisions (self-contained summary)

- **"Start from" is the second field, directly under Name,** so every way of
  opening the form keeps the keyboard in Name.
- **`Model.TEMPLATES`:** Fedora (`registry.fedoraproject.org/fedora-toolbox:latest`),
  Ubuntu 24.04 (`quay.io/toolbx/ubuntu-toolbox:24.04`), Debian 12
  (`quay.io/toolbx-images/debian-toolbox:12`) and Arch
  (`quay.io/toolbx/arch-toolbox:latest`).
  - Each has `packages: ""` and the init packages from distrobox's documentation:
    `systemd` for Fedora and Arch, and
    `systemd libpam-systemd pipewire-audio-client-libraries` for Debian and
    Ubuntu.
  - Each starts with `tested: false`, flipped only in the commit that records a
    live create, start with Init, and enter.
- **`templateChoices(query)`** returns Blank first, then the templates,
  filtered.
- **`applyTemplate(form, id)`** sets the image, the packages (plus the init
  packages if Init is on), a home of `~/.local/share/distrobox/<name>` (only for
  a valid name), `template: id`, and clears clone; it keeps the name. **Blank**
  resets the image, packages and home to the defaults.
- **`setInit(form, on)`** adds or removes exactly the current template's init
  tokens, and never a token the user typed.
- **`emptyForm()`** gains `template: ""`, which never reaches argv.
- **`FORM_FIELDS`** gains
  `{key: "template", kind: "template", label: "Start from", …}` after `name`.
- **`CreateForm.qml`:**
  - the template row with its inline list: ↓ and ↑ move, Enter picks, Esc
    leaves, and printable keys filter through `keySink`;
  - picking sets `root.form = Model.applyTemplate(…)`;
  - Init goes through `Model.setInit`.
- **Declined:** a template switching Init on, a Popup, and "Start from" in first
  place.
- **Depends on #4** (bound fields): the branch rebases onto `main` after #4
  merges.

## Steps

Each step is one commit on `feat/7-distro-templates`, citing `plan step N`. A
deviation updates this file in the same commit.

1. **Rebase onto `main` once #4 and #5 are merged.**
   → Verify: `node tests/run.js` passes, and `CreateForm.qml` has the bound
   `text:`.
2. **`Model.js`:** `TEMPLATES`, `templateChoices`, `applyTemplate`, `setInit`,
   `emptyForm().template`, and the `FORM_FIELDS` row. New
   `tests/model/templates.test.js` covers:
   - Blank first, and filtering;
   - applying a template (image, packages, home, name kept, clone cleared);
   - Blank resets;
   - `setInit` adds and removes exactly its tokens (with a user token that
     matches, and after switching templates);
   - every image passes `isImageRef`, every package list passes
     `isPackageList`, and `validateForm` accepts every template with a valid
     name;
   - `createArgv` never contains `template`.

   → Verify: `node tests/run.js` passes.
3. **`CreateForm.qml`:** the "Start from" row, its list, the filter, the
   `navKey` branch, and `setInit` wiring.
   → Verify: `nix flake check` passes, and the package still has 12 files.
4. **Live checks, in the popup and the menu.** The same discipline as #4 and #5:
   - ask the owner to step away, and announce on the bus;
   - stage `demo-*` boxes, on an empty workspace;
   - send keys only through the ownership guard (our plugin's `views`, the
     layer, the same shell pid);
   - tear down, and diff against the snapshot.

   The checks:
   1. Name, Tab, ↓, pick Ubuntu: image, packages and home change, and the name
      is kept.
   2. Init on or off adds or removes the three packages.
   3. Blank resets.
   4. IPC `create`, then typing, lands in Name.
   5. Filtering the list by typing works.
   6. **Tested marks:** create `demo-tpl-<id>` from each template with Init on,
      start it, and enter it. Record the result per template. The same commit
      flips `tested: true` only for those that passed, and removes the boxes
      (they are `demo-*`, recorded for teardown).

   → Verify: every result is recorded in the implementation record.
5. **Docs:** `usage.md` ("Create a box" gains "Start from"; Troubleshooting's
   "no init found" points to templates) and the README key table. Retake
   `form.png` if the new row changes the form's look.
   → Verify: the link check over the local Jekyll build passes, and
   `docs/img` is ≤ 8 MB.
6. **PR** (`Closes #7`) linking the artifacts. Merge once CI is green.
   → Verify: merged, and on `origin/main`.
7. **Host update:** a lock bump of `nixarchy-distrobox` in nixos_config, the
   same procedure as #4's plan step 5 (announce on the bus; start from a clean
   `main`; lock diff only this node; build-test; switch p620, then razer after
   the NVIDIA check; leave any other agent's stash alone). It can be combined
   with #8's if both are ready.
   → Verify: the new rev is on both hosts, 0 failed units, and the other
   agents' changes are untouched.

## Tests

- **A.** `node tests/run.js`.
- **B.** `nix flake check`, 12 package files.
- **C.** Live checks 1–6, both surfaces.
- **D.** The site link check and budget, if the docs or stills change.
- **E.** Host end-state checks.

## Rollback

- **Before merge:** close the PR.
- **After merge:** `git revert` the merge commit.
- **Hosts:** revert the lock bump and switch again, or
  `nixos-rebuild switch --rollback` on each host.
- **Boxes made for the tested marks** are `demo-*`, recorded, and removed by
  `docs/capture.sh --teardown`.

## Implementation record

### Deviations

_None yet._

### Test results

_Pending._
