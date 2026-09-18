const { test, eq, ok, psRow, dockerRow, box, HOST_HOME, Model } = require("../harness.js")

test("parseJsonLines keeps object lines and skips noise and broken JSON", () => {
  const raw = JSON.stringify(psRow()) + "\nWARN something\n{broken\n\n" + JSON.stringify(dockerRow()) + "\n"
  const got = Model.parseJsonLines(raw)
  eq(got.length, 2)
  eq(got[0].Names, "fedora")
  eq(got[1].Names, "ubuntu")
  eq(Model.parseJsonLines(undefined), [])
})

test("normalizeName takes the first name and drops docker's leading slash", () => {
  eq(Model.normalizeName("fedora"), "fedora")
  eq(Model.normalizeName("/fedora"), "fedora")
  eq(Model.normalizeName("fedora,web/alias"), "fedora")
  eq(Model.normalizeName(undefined), "")
})

test("isBoxName accepts engine names and refuses anything shell-shaped", () => {
  for (const good of ["fedora", "a", "my-box_1.2", "F42"]) ok(Model.isBoxName(good), good)
  for (const bad of ["", "-x", ".x", "a b", "a;b", "$(id)", "a/b", "x".repeat(64), "é"]) ok(!Model.isBoxName(bad), bad)
})

test("normalizeBox reads a podman row", () => {
  const b = box({}, { fedora: HOST_HOME + "/.local/share/distrobox/Fedora" })
  eq(b.id, "09b5a26202c0")
  eq(b.name, "fedora")
  eq(b.shortImage, "fedora-toolbox:latest")
  eq(b.up, true)
  eq(b.failing, false)
  eq(b.homeLabel, "~/.local/share/distrobox/Fedora")
})

test("normalizeBox reads a docker row, including an alias list in Names", () => {
  const b = Model.normalizeBox(dockerRow({ Names: "ubuntu,other/link" }), {}, HOST_HOME)
  eq(b.name, "ubuntu")
  eq(b.up, false)
  eq(b.exitCode, 0)
  eq(b.failing, false)
  eq(b.shortImage, "library/ubuntu:24.04")
})

test("a box that exited non-zero is failing; a stopped or created box is not", () => {
  eq(box({ State: "exited", Status: "Exited (1) 2 minutes ago" }).failing, true)
  eq(box({ State: "exited", Status: "Exited (126) 2 minutes ago" }).failing, true)
  // What `distrobox stop` leaves behind: TERM, or KILL after a timeout.
  eq(box({ State: "exited", Status: "Exited (143) 4 seconds ago" }).failing, false)
  eq(box({ State: "exited", Status: "Exited (137) 4 seconds ago" }).failing, false)
  eq(box({ State: "created", Status: "Created" }).failing, false)
})

test("normalizeBoxes drops rows whose id or name cannot reach argv", () => {
  const list = Model.normalizeBoxes([
    psRow(),
    psRow({ Names: "bad name" }),
    psRow({ ID: "../../x" }),
    psRow({ Names: "" })
  ], {}, HOST_HOME)
  eq(Model.boxNames(list), ["fedora"])
})

test("parseHomes reads name<TAB>HOME lines from both engines", () => {
  const raw = "fedora\t/home/user/.local/share/distrobox/Fedora\n/ubuntu\t/home/user\n/k3d-lb\t\nno-tab-line\nbad name\t/x\n"
  eq(Model.parseHomes(raw), {
    fedora: "/home/user/.local/share/distrobox/Fedora",
    ubuntu: "/home/user"
  })
})

test("homeLabel shortens paths under the host home only", () => {
  eq(Model.homeLabel("/home/user", HOST_HOME), "~")
  eq(Model.homeLabel("/home/user/boxes/f", HOST_HOME), "~/boxes/f")
  eq(Model.homeLabel("/home/userx/f", HOST_HOME), "/home/userx/f")
  eq(Model.homeLabel("/srv/boxes/f", HOST_HOME + "/"), "/srv/boxes/f")
  eq(Model.homeLabel("", HOST_HOME), "")
})

test("stripAnsi removes colour, OSC and \\r redraws", () => {
  eq(Model.stripAnsi("\x1b[32m [ OK ]\x1b[0m done"), " [ OK ] done")
  eq(Model.stripAnsi("\x1b]0;title\x07text"), "text")
  eq(Model.stripAnsi("10%\r50%\r100% complete"), "100% complete")
  eq(Model.stripAnsi("line\r"), "line")
  eq(Model.stripAnsi("a\tb"), "a\tb")
})

test("capLine cuts at 2 KB", () => {
  eq(Model.capLine("short"), "short")
  const long = Model.capLine("x".repeat(5000))
  eq(long.length, 2048)
  ok(long.endsWith("…"))
})

test("errorText returns the first meaningful line without the Error: prefix", () => {
  eq(Model.errorText("\n\nError: no such container fedora\nmore"), "no such container fedora")
  eq(Model.errorText("\x1b[31mCannot clone a running container.\x1b[0m"), "Cannot clone a running container.")
  eq(Model.errorText(""), "")
})
