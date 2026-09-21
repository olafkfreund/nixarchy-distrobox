const { test, eq, ok, box, Model } = require("../harness.js")

const running = (name) => box({ Names: name, ID: name + "0", State: "running", Status: "Up 1 hour" })
const stopped = (name, code) => box({ Names: name, ID: name + "0", State: "exited", Status: "Exited (" + (code || 0) + ") 1 day ago" })

test("sortBoxes puts running first, then failing, then by name", () => {
  const got = Model.sortBoxes([stopped("b"), stopped("a", 1), running("z"), stopped("c"), running("m")])
  eq(Model.boxNames(got), ["m", "z", "a", "b", "c"])
})

test("sortBoxes orders names case-insensitively", () => {
  eq(Model.boxNames(Model.sortBoxes([stopped("demo-u"), stopped("Fedora"), stopped("Debian")])), ["Debian", "demo-u", "Fedora"])
})

test("visibleBoxes hides stopped boxes only when asked, then filters", () => {
  const list = [running("fedora"), stopped("arch"), stopped("alpine")]
  eq(Model.boxNames(Model.visibleBoxes(list, true, "")), ["fedora", "arch", "alpine"])
  eq(Model.boxNames(Model.visibleBoxes(list, false, "")), ["fedora"])
  eq(Model.boxNames(Model.visibleBoxes(list, true, "al")), ["alpine"])
  eq(Model.visibleBoxes(list, false, "al").length, 0)
})

test("filterBoxes matches name or image, case-insensitively", () => {
  const arch = box({ Names: "arch", ID: "arch0", State: "exited", Status: "Exited (0) 1 day ago", Image: "quay.io/toolbx/arch-toolbox:latest" })
  const list = [running("fedora"), arch]
  eq(Model.boxNames(Model.filterBoxes(list, "FED")), ["fedora"])
  eq(Model.boxNames(Model.filterBoxes(list, "ARCH-toolbox")), ["arch"])
  eq(Model.boxNames(Model.filterBoxes(list, "toolbox")), ["fedora", "arch"])
  eq(Model.filterBoxes(list, "  ").length, 2)
})

test("rowsFor builds keyed rows with subtitle and status", () => {
  const rows = Model.rowsFor([stopped("arch", 2), running("fedora")])
  eq(rows.map(r => r.key), ["fedora", "arch"])
  eq(rows[0].subtitle, "fedora-toolbox:latest")
  eq(rows[1].status, "Exited (2)")
  eq(rows[1].failing, true)
  eq(Model.rowsFor([stopped("a", 143)])[0].status, "Stopped")
  eq(Model.rowsFor([stopped("a", 0)])[0].status, "Stopped")
  eq(Model.rowsFor([box({ Names: "c", ID: "c0", State: "created", Status: "Created" })])[0].status, "Created")
})

test("rowRecord types every field", () => {
  const rec = Model.rowRecord({ key: "k", id: "i", name: "n", up: "yes" })
  eq(rec.up, false)
  eq(rec.failing, false)
  eq(rec.subtitle, "")
  eq(Object.keys(rec).sort(), ["failing", "home", "id", "image", "key", "name", "status", "subtitle", "up"])
})

test("clampCursor keeps the cursor inside the list", () => {
  eq(Model.clampCursor(5, 3), 2)
  eq(Model.clampCursor(-1, 3), 0)
  eq(Model.clampCursor(4, 0), 0)
})

test("reconcilePlan turns one key order into another", () => {
  const apply = (keys, rows) => {
    const out = keys.slice()
    for (const op of Model.reconcilePlan(keys, rows)) {
      if (op.op === "remove") out.splice(op.index, 1)
      else if (op.op === "insert") out.splice(op.index, 0, op.row.key)
      else out.splice(op.to, 0, out.splice(op.from, 1)[0])
    }
    return out
  }
  const rows = (...keys) => keys.map(key => ({ key }))
  eq(apply(["a", "b", "c"], rows("c", "a", "d")), ["c", "a", "d"])
  eq(apply([], rows("a")), ["a"])
  eq(apply(["a"], []), [])
  eq(Model.reconcilePlan(["a", "b"], rows("a", "b")), [])
})

test("counts, summaryText and footerText", () => {
  const list = [running("a"), stopped("b", 1), stopped("c")]
  eq(Model.counts(list), { total: 3, running: 1, stopped: 2, failing: 1 })
  eq(Model.summaryText(list, true, "podman"), "1 of 3 running")
  eq(Model.summaryText([], true, "podman"), "No boxes")
  eq(Model.summaryText(list, false, "docker"), "docker unreachable")
  eq(Model.footerText(list), "3 boxes · 1 running")
  eq(Model.footerText([running("a")]), "1 box · 1 running")
})

test("emptyText says why the list is empty", () => {
  const base = { everLoaded: true, reachable: true, engine: "podman", filtered: false, showStopped: true }
  eq(Model.emptyText(Object.assign({}, base, { everLoaded: false })), "Loading…")
  eq(Model.emptyText(Object.assign({}, base, { reachable: false })), "podman unreachable")
  eq(Model.emptyText(Object.assign({}, base, { filtered: true })), "Nothing matches that filter")
  eq(Model.emptyText(Object.assign({}, base, { showStopped: false })), "No running boxes")
  eq(Model.emptyText(base), "No boxes yet — press c to create one")
})

test("every shortcut group renders, in the order first seen", () => {
  const groups = Model.shortcutGroups()
  eq(groups.map(g => g.title), ["Move", "Box", "All boxes", "Panel", "Create form", "Log"])
  ok(groups.every(g => g.entries.length > 0))
})

test("cursorAfter follows the box, not the row", () => {
  const rows = (...keys) => keys.map(key => ({ key }))
  eq(Model.cursorAfter("b", rows("b", "a"), 1), 0)          // moved up
  eq(Model.cursorAfter("b", rows("a", "c", "b"), 0), 2)     // moved down
  eq(Model.cursorAfter("b", rows("a", "b"), 1), 1)          // unmoved
  eq(Model.cursorAfter("gone", rows("a", "c"), 1), 1)       // removed: same row
  eq(Model.cursorAfter("gone", rows("a"), 4), 0)            // removed: clamped
  eq(Model.cursorAfter("b", [], 1), 0)                      // empty list
  eq(Model.cursorAfter("", rows("a", "b"), 1), 1)           // no key: clamp only
  eq(Model.cursorAfter("", rows("a"), -1), 0)
})

test("cursorAfter keeps the cursor on a box that moves up when it starts", () => {
  const before = Model.rowsFor([running("z"), stopped("b")])   // z, b
  eq(before.map(r => r.key), ["z", "b"])
  const after = Model.rowsFor([running("z"), running("b")])    // b, z
  eq(after.map(r => r.key), ["b", "z"])
  eq(Model.cursorAfter("b", after, 1), 0)
})

test("cursorAfter: after its box is gone, the fallback row's box is followed", () => {
  const rows = (...keys) => keys.map(key => ({ key }))
  const at = Model.cursorAfter("gone", rows("a", "c", "d"), 1)
  eq(at, 1)
  const remembered = rows("a", "c", "d")[at].key                // "c"
  eq(Model.cursorAfter(remembered, rows("c", "a", "d"), at), 0)
})

test("stepCursor: the first step from an inactive cursor lands on its row", () => {
  eq(Model.stepCursor(false, 0, 1, 5), 0)
  eq(Model.stepCursor(false, 0, -1, 5), 0)
  eq(Model.stepCursor(true, 0, 1, 5), 1)
  eq(Model.stepCursor(true, 4, 1, 5), 4)
  eq(Model.stepCursor(true, 2, -1, 5), 1)
  eq(Model.stepCursor(true, 3, 1, 0), 0)
})

test("footerKeys only in the list; logHint drops scrolling when nothing scrolls", () => {
  eq(Model.footerKeys("list", false), "? keys   c create   esc close")
  eq(Model.footerKeys("list", true), "working…")
  for (const mode of ["form", "log", "snippet"]) eq(Model.footerKeys(mode, false), "")
  eq(Model.logHint(true, false, false), "esc back")
  eq(Model.logHint(true, true, false), "following   j k scroll   esc back")
  eq(Model.logHint(false, true, true), "G follow   j k scroll   esc back (keeps running)")
  eq(Model.logHint(true, false, true), "following   j k scroll   esc back (keeps running)")
})
