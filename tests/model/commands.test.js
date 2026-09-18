const { test, eq, ok, box, Model } = require("../harness.js")

const PREFIX = ["env", "DBX_CONTAINER_MANAGER=podman"]
const starts = (argv, prefix) => eq(argv.slice(0, prefix.length), prefix)

test("engineFor maps anything but exactly docker to podman", () => {
  eq(Model.engineFor("docker"), "docker")
  for (const v of ["podman", "Docker", "", undefined, "sh -c id", "docker "]) eq(Model.engineFor(v), "podman")
})

test("every distrobox argv starts with the engine, and the engine is never user text", () => {
  const all = [
    Model.startArgv("podman", "f"),
    Model.stopArgv("podman", ["f"]),
    Model.removeArgv("podman", "f"),
    Model.upgradeArgv("podman", "f"),
    Model.upgradeArgv("podman", null),
    ...Model.restartArgvs("podman", "f")
  ]
  for (const argv of all) {
    ok(Array.isArray(argv))
    starts(argv, PREFIX)
    ok(argv.every(a => typeof a === "string"))
  }
  starts(Model.removeArgv("docker", "f"), ["env", "DBX_CONTAINER_MANAGER=docker"])
  starts(Model.removeArgv("$(id)", "f"), PREFIX)
})

test("enter runs distrobox inside the terminal, with the engine", () => {
  eq(Model.enterArgv("docker", "f"), [
    "omarchy-launch-tui", "--app-id=org.omarchy.distrobox-enter",
    "env", "DBX_CONTAINER_MANAGER=docker", "distrobox", "enter", "f"
  ])
})

test("start waits for the box's setup through distrobox enter", () => {
  eq(Model.startArgv("podman", "f"), PREFIX.concat(["distrobox", "enter", "--name", "f", "-T", "--", "true"]))
})

test("stop takes several names; rm is --force without --yes or --rm-home", () => {
  eq(Model.stopArgv("podman", ["a", "b"]), PREFIX.concat(["distrobox", "stop", "--yes", "a", "b"]))
  eq(Model.removeArgv("podman", "a"), PREFIX.concat(["distrobox", "rm", "--force", "a"]))
})

test("upgrade one or all, never with DBX_NON_INTERACTIVE (it would auto-create a missing box)", () => {
  eq(Model.upgradeArgv("podman", "a"), PREFIX.concat(["distrobox", "upgrade", "a"]))
  eq(Model.upgradeArgv("podman", "").slice(-1), ["--all"])
  for (const argv of [Model.upgradeArgv("podman", "a"), Model.startArgv("podman", "a"), Model.enterArgv("podman", "a")]) {
    ok(!argv.some(a => a.indexOf("DBX_NON_INTERACTIVE") === 0))
  }
})

test("restart is stop then start", () => {
  const [stop, start] = Model.restartArgvs("podman", "a")
  eq(stop, Model.stopArgv("podman", ["a"]))
  eq(start, Model.startArgv("podman", "a"))
})

test("an invalid name gives null, never a command", () => {
  for (const bad of ["", "a b", "$(id)", "-rf", "x;y", undefined]) {
    eq(Model.enterArgv("podman", bad), null)
    eq(Model.startArgv("podman", bad), null)
    eq(Model.removeArgv("podman", bad), null)
    eq(Model.restartArgvs("podman", bad), null)
    eq(Model.copyArgv(bad), null)
  }
  eq(Model.stopArgv("podman", ["ok", "b ad"]), null)
  eq(Model.stopArgv("podman", []), null)
  eq(Model.upgradeArgv("podman", "a;b"), null)
  eq(Model.inspectHomesArgv("podman", []), null)
})

test("list and inspect argv", () => {
  const list = Model.listArgv("docker", true)
  eq(list.slice(0, 5), ["docker", "ps", "-a", "--no-trunc", "--filter"])
  eq(list[5], "label=manager=distrobox")
  eq(list[list.length - 1], Model.BOX_FORMAT)
  ok(Model.listArgv("podman", false).indexOf("-a") === -1)
  eq(Model.inspectHomesArgv("podman", ["a", "b"]).slice(-2), ["a", "b"])
})

test("actionsFor offers start or stop by state and locks mutations", () => {
  const up = Model.rowsFor([box({ State: "running" })])[0]
  const down = Model.rowsFor([box({ State: "exited", Status: "Exited (0) now" })])[0]
  eq(Model.actionsFor(up, {}).map(a => a.verb), ["enter", "restart", "stop", "upgrade", "remove"])
  eq(Model.actionsFor(down, {}).map(a => a.verb), ["enter", "start", "upgrade", "remove"])
  const locked = Model.actionsFor(down, { mutating: true })
  eq(locked.filter(a => a.enabled).map(a => a.verb), ["enter"])
  ok(Model.allowsVerb(down, "start", {}))
  ok(!Model.allowsVerb(down, "start", { mutating: true }))
  ok(!Model.allowsVerb(down, "stop", {}))
  eq(Model.actionsFor(null, {}), [])
})

test("removeMessage says the home directory is kept", () => {
  const custom = box({}, { fedora: "/home/user/boxes/f" })
  ok(Model.removeMessage(custom, "/home/user").indexOf("/home/user/boxes/f is kept") !== -1)
  const shared = box({}, { fedora: "/home/user" })
  ok(Model.removeMessage(shared, "/home/user").indexOf("shares your home") !== -1)
  eq(Model.stopAllMessage(1), "Stop 1 running box?")
  eq(Model.stopAllMessage(3), "Stop 3 running boxes?")
})
