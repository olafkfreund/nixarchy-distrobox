---
status: draft
issue: 4
intent: intent/2026-09-18-4-form-stale-text.md
---

# Spec: the create form opens empty every time

## Decisions taken from the intent's open questions

The owner approved the intent with its default:

1. **No drafts.** Reopening always shows a fresh form (empty, apart from the
   default image). Keeping a half-typed form would be a separate feature.

## Facts this design rests on

Checked in the code, and confirmed independently by a Codex review
(`gpt-6-astra`, read-only):

- `start()` (`CreateForm.qml:48`) replaces `root.form` with `Model.emptyForm()`
  and sets `advanced = false`.
- Each text field sets its text only in `Component.onCompleted` (line 328). The
  Repeater's model is `root.fields = Model.visibleFields(advanced)` (line 39),
  which depends on `advanced`, not on `form`. So with Advanced closed, the same
  delegates survive a reopen and keep their text.
- **The bug hides when Advanced was open:** `start()` turns it off, `fields`
  changes, the delegates are rebuilt from the fresh data, and the form looks
  right. A test has to reopen with Advanced closed.
- **A second path writes text directly:** `pickImage()` calls `item.setText()`
  (line 127), which is `input.text = value` (line 240).
- **Submitting uses `root.form`, not the visible text.** An old Name on screen
  can therefore fail "A name is required", and an old Home on screen is silently
  dropped.
- **The reset is to defaults, not all empty:** Image goes back to
  `DEFAULT_IMAGE` (`Model.emptyForm`).
- In QML, a user editing a text field does not remove its `text:` binding. An
  imperative `input.text = …` in JavaScript does. `textEdited` fires only for
  user edits, never for a programmatic change.

## Design

**Bind each field's text to the form's data.**

In the text field delegate:

```qml
text: fieldItem.takesText ? String(root.form[fieldItem.modelData.key] || "") : ""
onTextEdited: {
  root.imageIndex = -1
  root.setValue(fieldItem.modelData.key, text)
}
```

- **Remove** `Component.onCompleted: … text = …` (line 328). It is an
  imperative write that would break the binding on every newly created
  delegate.
- **Remove** `function setText(value)` (line 240), and the delegate lookup plus
  `item.setText()` in `pickImage()` (lines 126–127). `pickImage()` keeps
  `setValue("image", …)` and the `imageIndex` reset; the binding shows the new
  value.
- **Keep** `setValue()`'s whole-object replacement. Assigning a new object is
  what notifies the `var` binding.
- **Keep** `onTextEdited`, not `onTextChanged`: a programmatic change does not
  fire it, so there is no model → text → model loop.
- **Feed back the exact edited string.** The text setter ignores identical text,
  so the cursor and selection stay put while typing. Trimming stays in validation
  and `createArgv`, as today.
- **Focus is untouched:** `start()` still defers `focusCurrent`, and IPC `create`
  keeps its focus in Name.

**Fallback,** decided now in case the live check fails: if typing with the binding
moves the text cursor or drops keystrokes in the installed Qt, switch to reseeding.
That means `start()` writes each surviving delegate's text from the fresh form
before the deferred focus, and `pickImage()` keeps its direct write. The plan
records it as a deviation.

**Pinned by the regression check:** pressing Space on the Advanced row with the
keyboard does not call `focusCurrent()`, while a mouse click does. Toggling
rebuilds delegates, but the section row's focus is on `keySink`, which is not
rebuilt, so focus should hold. The live check confirms it. If it fails, the fix
(`Qt.callLater(root.focusCurrent)` after the toggle) lands here as a deviation.

## Alternatives rejected

- **Reseeding in `start()` as the primary fix.** It works for the reopen path,
  but keeps two sources of displayed state and still needs the direct write in
  `pickImage()`. It stays as the fallback above.
- **Destroying the form (a `Loader`) on every close.** It fixes the symptom by
  rebuilding everything. It is heavier, and fighting keep-loaded focus
  behaviour is what already cost two fixes in #1.
- **Keeping a draft.** Declined (decision 1).

## Risks

- **Text cursor or IME behaviour under the binding.** It is covered by live
  editing checks, and the fallback above.
- **A binding loop warning** in `qs log`. Checked live; there should be none,
  because `textEdited` does not fire for the binding's own writes.
- **The image list,** where picking now updates the field only through the
  binding. Checked live.

## Verification

- **Node:** `emptyForm()` returns an independent object. Mutating one result
  leaves the next call's defaults intact. That guards the reset's data side.
  The existing 56 tests still pass.
- **Live, in the popup and the menu:**
  1. Type a name, image, home and packages, cancel (Esc), and reopen **with
     Advanced closed**. Every field shows the defaults.
  2. The same after a real create of a throwaway `demo-*` box.
  3. Pick an image from the list, edit it by hand, reopen: default image.
  4. Open Advanced, type in Volumes, cancel, reopen, open Advanced again:
     Volumes is empty.
  5. Mid-text editing (move the cursor and insert, select and replace, paste):
     the cursor stays where it was typed, and nothing is lost.
  6. Space on the Advanced row, then Tab: focus moves to Hostname.
  7. IPC `create` (bar and menu), then typing at once: the text lands in Name.
  8. `qs log`: no binding-loop warnings from `CreateForm.qml`.
- `nix flake check` passes.
