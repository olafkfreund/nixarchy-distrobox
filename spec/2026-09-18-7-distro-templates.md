---
status: approved
issue: 7
intent: intent/2026-09-18-7-distro-templates.md
---

# Spec: distro templates, a "Start from" list in the create form

## Decisions taken from the intent's open questions

The owner approved the intent with its defaults:

1. **The built-in set** is Fedora, Ubuntu 24.04, Debian 12 and Arch, each tested
   live before it is marked tested.
2. **Picking a template overwrites** the image, the extra packages and the home,
   and **never** the name.
3. **A template does not switch Init on.** It adds its init packages only while
   Init is on.

## A decision this spec adds

**Name stays the first field; "Start from" comes directly after it.** The intent
said "at the top", but the form's contract (#1, and #4's live checks) is that
opening it (`c`, IPC `create`, `{"create":true}`) puts the keyboard in Name. With
the list first, IPC `create` followed by typing would filter templates instead
of naming the box. Second place keeps that contract, and the list is still the
first thing under the name.

## Facts this design rests on

- **The init packages come from distrobox's own documentation** for 1.8.2.5
  (`docs/useful_tips.md`, "Using init system inside a distrobox"):
  - Debian and Ubuntu: `systemd libpam-systemd pipewire-audio-client-libraries`;
  - Arch: `systemd`;
  - Fedora: `systemd`.
  - *Correction:* the intent and issue #7 said `systemd libpam-systemd dbus` for
    Debian and Ubuntu, which was from memory and wrong. The documented list is
    used here.
- **The form's fields** are the `Model.FORM_FIELDS` table. `kind` picks the
  widget (`text`, `image`, `bool`, `clone`, `section`).
  - The image field's inline list is `root.imageChoices` with `imageIndex`
    (`CreateForm.qml`). ↓ enters it, Enter picks, Esc leaves.
  - `navKey()` decides every navigation key, and its `onImage` branch is the
    pattern to copy.
- **After #4, every text field binds to `root.form`,** so a template that
  replaces `root.form` shows up in the fields with no further wiring. This task
  therefore lands after #4.
- **Every create value goes through `Model.validateForm`'s per-field
  allowlists.** Template values are plain strings from `Model.js`, but they take
  the same route.

## Design

### 1. `Model.js`: the template table, and applying one

```js
var TEMPLATES = [
  { id: "fedora", label: "Fedora", image: "registry.fedoraproject.org/fedora-toolbox:latest",
    packages: "", initPackages: "systemd", tested: false },
  { id: "ubuntu", label: "Ubuntu 24.04", image: "quay.io/toolbx/ubuntu-toolbox:24.04",
    packages: "", initPackages: "systemd libpam-systemd pipewire-audio-client-libraries", tested: false },
  { id: "debian", label: "Debian 12", image: "quay.io/toolbx-images/debian-toolbox:12",
    packages: "", initPackages: "systemd libpam-systemd pipewire-audio-client-libraries", tested: false },
  { id: "arch", label: "Arch", image: "quay.io/toolbx/arch-toolbox:latest",
    packages: "", initPackages: "systemd", tested: false }
]
```

- `tested` becomes `true` for a template only in the commit that records its
  live test: created, started with Init on, and entered. Nothing is marked
  tested ahead of that.
- `packages` starts empty for every built-in. A template's value is the correct
  image plus the init packages; its common extras stay the user's choice, and
  the table can gain them later.
- **`templateChoices(query)`** returns `[Blank] + TEMPLATES`, filtered like
  `imagesMatching`. Blank has `id: ""`.
- **`applyTemplate(form, id)`** returns a new form:
  - `template: id`;
  - `image` set to the template's image;
  - `additionalPackages` set to `joinPackages(t.packages, form.init ? t.initPackages : "")`;
  - `home` set to `~/.local/share/distrobox/<name>` when the name is valid and
    set, otherwise `""`;
  - `name` untouched;
  - `clone` cleared, because a template means an image.
  - **Blank** (`id: ""`) resets image, packages and home to the `emptyForm()`
    defaults and keeps the name.
- **`setInit(form, on)`** returns a new form with `init` set. When
  `form.template` names a template, it adds that template's `initPackages`, or
  removes them, from `additionalPackages` as whole tokens. It never removes a
  token that was not added by that template's init set: a package the user
  typed that happens to match stays when Init goes off, because only the
  template's exact tokens are removed, and only when they are present.
- **`emptyForm()`** gains `template: ""`. `validateForm` and `createArgv` ignore
  it; it is never passed to distrobox.
- **`FORM_FIELDS`** gains `{ key: "template", kind: "template", label: "Start from", hint: "↓ picks a distro; fills image, packages and home" }`
  directly after `name`. `visibleFields` needs no change.

### 2. `CreateForm.qml`: the "Start from" field

- **Its own delegate branch, alongside `image`:** a read-only row that shows the
  chosen template's label (or "Blank"), with the same inline list underneath
  when it is the current field. `root.templateChoices` and `templateIndex`
  mirror `imageChoices` and `imageIndex`.
- **`navKey()`** gains an `onTemplate` branch, the same shape as `onImage`: ↓
  and ↑ move in the list, Enter picks, Esc leaves the list.
  - Because the row is not a text field, typing to filter uses the same
    `keySink` route as the switch rows: printable keys append to a small filter
    string; Backspace deletes.
- **Picking** calls `root.form = Model.applyTemplate(root.form, id)`. After #4,
  the bound fields update themselves.
- **The Init switch** goes through `Model.setInit`, so its packages follow it.
- **Each list row** shows `label   image`, plus a small `tested` tag when the
  template is marked tested.

### 3. Docs

- **`usage.md`:** "Create a box" gains the "Start from" step, and
  Troubleshooting's "no init found" entry points to the templates.
- **The README:** a row in the form key table.
- **The showcase stills** (`form.png`, `form-advanced.png`) are retaken only if
  the form's layout visibly changes: one new row under Name. Otherwise they go
  on the follow-up list.

## Alternatives rejected

- **"Start from" as the first field.** It breaks the Name-focus contract (see
  "A decision this spec adds").
- **A template that also switches Init on.** Declined (decision 3): Init changes
  process visibility inside the box, and should stay a deliberate choice.
- **Templates in their own tab, or in a second screen before the form.** One
  more step for every create; a field in the form costs nothing when unused
  (Blank).
- **Storing templates as a file the plugin ships.** Built-ins are code (tested
  in Node); files are #8's job.
- **A Popup list.** It ignores the menu's 1.45× scale.

## Risks

- **Init packages moving between distro releases.** They are pinned to
  distrobox's documented list and verified live per template; `tested` stays
  false until then.
- **The name-dependent home:** if the name changes after a template is picked,
  the home still names the old name. Accepted: the home field is visible and
  editable, and re-picking the template refreshes it.
- **The keyboard filter on a non-text row** is new behaviour. It is covered by
  live checks.
- **A second inline list** in the form makes it taller. It is shown only while
  its field is current, as the image list is.

## Verification

- **Node** (`tests/model/templates.test.js`):
  - `templateChoices` puts Blank first, and filters;
  - `applyTemplate` fills the image, packages and home, keeps the name, clears
    clone, and Blank resets;
  - `setInit` adds and removes exactly the template's init tokens, and never
    removes a token the user typed or one from another template;
  - every template's image passes `isImageRef`, and its packages pass
    `isPackageList`;
  - `validateForm` accepts every template applied to a valid name;
  - `emptyForm().template === ""`, and `createArgv` never contains a
    `template` value.
- **Live, in the popup and the menu:**
  1. Name, then Tab to "Start from", ↓, pick Ubuntu: the image, packages and
     home fields change, and the name is kept.
  2. Init on: the packages gain the three init packages. Init off: they go.
  3. Blank resets the three fields.
  4. IPC `create`, then type at once: the text lands in Name, not the template
     filter.
  5. **The tested mark:** create, start with Init on, and enter a box from each
     of the four templates. Only those that pass are flipped to `tested: true`,
     in the commit that records the result.
- `nix flake check` passes, and the package still has 12 files.
