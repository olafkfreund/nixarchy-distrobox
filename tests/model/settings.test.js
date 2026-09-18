const { test, eq, ok, Model } = require("../harness.js")

const ID = "nixarchy.distrobox"
const defaults = () => ({ refreshIntervalSec: 30, showStopped: true, containerManager: "podman" })

test("settingsFor falls back to the defaults when there is no bar config", () => {
  eq(Model.settingsFor(undefined, ID, defaults()), defaults())
  eq(Model.settingsFor({}, ID, defaults()), defaults())
  eq(Model.settingsFor({ layout: { right: [ID] } }, ID, defaults()), defaults())
})

test("settingsFor finds the entry in any region of bar.layout", () => {
  for (const region of ["left", "center", "right"]) {
    const bar = { layout: { [region]: [{ id: "other", showStopped: true }, { id: ID, showStopped: false }] } }
    eq(Model.settingsFor(bar, ID, defaults()).showStopped, false)
  }
})

test("settingsFor reads a layout passed without the bar wrapper", () => {
  eq(Model.settingsFor({ left: [{ id: ID, containerManager: "docker" }] }, ID, defaults()).containerManager, "docker")
})

test("settingsFor takes the first matching entry", () => {
  const bar = { layout: { left: [{ id: ID, refreshIntervalSec: 30 }], right: [{ id: ID, refreshIntervalSec: 60 }] } }
  eq(Model.settingsFor(bar, ID, defaults()).refreshIntervalSec, 30)
})

test("settingsFor ignores values of the wrong type and keys it does not know", () => {
  const bar = { layout: { right: [{ id: ID, showStopped: "no", refreshIntervalSec: 45, bogus: 1 }] } }
  const got = Model.settingsFor(bar, ID, defaults())
  eq(got.showStopped, true)
  eq(got.refreshIntervalSec, 45)
  ok(!("bogus" in got))
})

test("settingsFor reads Qt sequence wrappers, which are not JS arrays", () => {
  // What QML hands over for a list read through a QObject property.
  const wrapped = { length: 2, 0: { id: "other" }, 1: { id: ID, showStopped: false } }
  ok(!Array.isArray(wrapped))
  eq(Model.settingsFor({ layout: { right: wrapped } }, ID, defaults()).showStopped, false)
})

test("settingsFor never mutates the defaults it is given", () => {
  const d = defaults()
  Model.settingsFor({ layout: { right: [{ id: ID, showStopped: false }] } }, ID, d)
  eq(d, defaults())
})

test("settingsFor passes the containerManager enum through as a string", () => {
  const bar = { layout: { right: [{ id: ID, containerManager: "docker" }] } }
  eq(Model.settingsFor(bar, ID, defaults()).containerManager, "docker")
})
