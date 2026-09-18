---
status: draft
issue: 5
intent: intent/2026-09-18-5-cursor-follows-box.md
---

# Spec: the cursor stays on the same box when the list re-sorts

## Decisions taken from the intent's open questions

The owner approved the intent with its defaults:

1. **The cursor follows its box on every refresh,** not only after the user's own
   action.
2. **When the followed box disappears,** the cursor keeps its row number, clamped
   to the list, which is today's behaviour.

## Facts this design rests on

Checked in the code, and confirmed independently by a Codex review
(`gpt-6-astra`, read-only, which also ran the 56 existing tests):

- `Model.rowsFor()` sorts on every refresh (running, then failing, then name), and
  each row's key is the box name (`Model.js:283`, `:331`).
- `DistroboxView.qml` holds only `cursorIndex` (line 40). `onRowsChanged` clamps
  it (line 52), so the same index can name another box after a re-sort. Enter,
  `x`, `s`, `r`, `g`, `y` and the row buttons all resolve their target from
  `cursorBox`, which is `rows[cursorIndex]`.
- **The re-sort is not only at the end of an action.** While a surface is open,
  the list refreshes every 3 s (`DistroboxState.qml`, the 3000 ms timer), and any
  change of state (a start, stop, failure, create or delete, from this plugin or
  from anywhere else) can reorder rows.
- `BoxList.qml` reconciles its `ListModel` by key, which keeps delegates but not
  the view's selection.
- **Hover reports an index:** `cursorRequested(int index)` (`BoxList.qml:31`),
  emitted on `containsMouseChanged` (`:119`). While reconciliation moves rows, an
  intermediate index can name a different final row.
- **Cursor mutation paths** in `DistroboxView.qml`:
  - `reset()`, when a surface opens;
  - `moveCursor()`, for `j`/`k`/arrows (including stepping up into the filter,
    which sets `cursorActive = false`);
  - `setCursor()`, for hover;
  - the filter's `onTextChanged` (`cursorIndex = 0`).

## Design

### 1. `Model.js`: `cursorAfter(prevKey, rows, prevIndex)`

It sits beside `clampCursor()`:

```js
// Where the cursor belongs after the rows changed: on the same box if it is
// still listed, otherwise on the same row number, clamped to the new list.
function cursorAfter(prevKey, rows, prevIndex) {
  var next = rows || []
  if (prevKey) {
    for (var i = 0; i < next.length; i++) {
      if (next[i].key === prevKey) return i
    }
  }
  return clampCursor(prevIndex, next.length)
}
```

| Situation | Result |
|---|---|
| The box is still listed | Its new index, wherever it moved |
| The box was removed or filtered out | The previous index, clamped (the next row, or the last one) |
| The list is empty | `0`, the existing convention (no row is shown as selected) |
| No key remembered (cursor inactive) | The previous index, clamped |

### 2. `DistroboxView.qml`: remember the box, not only the row

- **A new property, `cursorKey: ""`,** stored independently. It is not bound to
  `cursorRow.key`, because a binding would re-read the already re-sorted list and
  follow the wrong box.
- **One helper sets both:**

  ```qml
  function rememberCursor(index) {
    root.cursorIndex = Model.clampCursor(index, root.rows.length)
    root.cursorKey = root.cursorActive && root.rows.length > 0
      ? root.rows[root.cursorIndex].key : ""
  }
  ```

- **On a refresh,**
  `onRowsChanged: root.rememberCursor(Model.cursorAfter(root.cursorActive ? root.cursorKey : "", root.rows, root.cursorIndex))`.
- **Every mutation path goes through `rememberCursor`:**
  - `moveCursor()`: the final index assignment becomes
    `rememberCursor(cursorIndex + delta)`. Stepping up into the filter clears
    `cursorKey`.
  - `setCursor()` becomes `rememberCursor(index)`.
  - `reset()` clears `cursorKey`, then calls `rememberCursor(0)`.
  - The filter's `onTextChanged` clears `cursorKey` *before* `filterText`
    changes, then calls `rememberCursor(0)`. Typing in the filter still starts
    from the top.
- **An empty list** leaves `cursorActive` alone (today's behaviour). An active
  cursor resumes on row 0 when rows come back; the action handlers already refuse
  a null `cursorBox`.

### 3. Hover sends a key, not an index

- `BoxList.qml`: `signal cursorRequested(string key)`, emitted with the row's
  key.
- The view resolves the key against its current `rows`, and **ignores a key that
  is no longer listed** instead of clamping. A hover during a re-sort can then
  never land on another box.
- **Known limit, to verify live:** a real hover still moves the cursor, and a row
  sliding under a parked pointer may count as a hover. If it does, the plan
  records it; a fix that tells pointer movement from layout movement is out of
  scope unless the owner asks.

## Alternatives rejected

- **Freezing the order while a panel is open.** It hides state changes, which is
  the point of the list, and it does not help a box removed from elsewhere.
- **Binding `cursorKey` to `cursorRow.key`.** It re-reads the re-sorted list, so
  it follows the wrong box (the same bug).
- **Watching `onCursorIndexChanged` only.** The selected box can change while the
  index stays the same (for example, row 0 re-sorted), so nothing would fire.
- **Keying on the container id.** It changes when a box is re-created with the
  same name. The name is the identity every command already uses.

## Risks

- **A missed mutation path** would leave `cursorKey` stale, and the cursor would
  jump back to an old box on the next refresh. Mitigation: the plan lists every
  path, and the live checks exercise each one (keys, hover, filter, reset,
  empty list).
- **Hover under a parked pointer** (see §3), verified live.
- **Scrolling:** a followed box can move out of view. `BoxList` already keeps the
  current index visible when it changed from the keyboard; the live checks cover a
  box moving while keyboard-selected.

## Verification

- **Node tests** (`tests/model/rows.test.js`), all passing with the existing 56.
  `cursorAfter` must cover:
  - a moved key (up and down);
  - an unmoved key;
  - a removed key (clamped);
  - an empty list;
  - no remembered key;
  - a `rowsFor` re-sort after a start;
  - the sequence "the key disappears, the fallback row is remembered, a later
    re-sort follows the fallback".
- **Live, in the popup and the menu,** with throwaway `demo-*` boxes:
  1. Put the cursor on a stopped box below another row and press `s`. When it
     is running and has moved up, the cursor is still on it: the highlight,
     `y` (copy name), Enter, and `x` all name that box (cancel the delete).
  2. The same, having put the cursor there with the mouse.
  3. Delete the selected box from a terminal; the cursor lands on the next row.
  4. Filter to nothing, then clear the filter: the cursor is on row 0.
  5. An inactive cursor stays inactive through refreshes.
  6. A parked pointer over a row while the list re-sorts: record what happens.
- `nix flake check` passes.
