const { test, eq, ok, box, Model } = require("../harness.js")

const ENGINE = ["env", "DBX_CONTAINER_MANAGER=podman"]
// A cancellable mutation runs in its own session, so cancelling it can signal
// the whole group. `enter` and the read-only calls deliberately do not.
const PREFIX = ["setsid"].concat(ENGINE)
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
    ...Model.upgradeAllArgvs("podman", ["f", "g"]),
    ...Model.restartArgvs("podman", "f")
  ]
  for (const argv of all) {
    ok(Array.isArray(argv))
    starts(argv, PREFIX)
    ok(argv.every(a => typeof a === "string"))
  }
  starts(Model.removeArgv("docker", "f"), ["setsid", "env", "DBX_CONTAINER_MANAGER=docker"])
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

test("only the cancellable mutations get their own session", () => {
  // Cancelling has to reach the engine, and distrobox is a chain of bash
  // scripts several levels deep, so each of these runs in a session of its own.
  for (const argv of [
    Model.startArgv("podman", "f"),
    Model.stopArgv("podman", ["f"]),
    Model.removeArgv("podman", "f"),
    Model.upgradeArgv("podman", "f"),
    Model.createArgv(Object.assign(Model.emptyForm(), { name: "f" }), "podman", [], "/home/u"),
    ...Model.upgradeAllArgvs("podman", ["f"]),
    ...Model.restartArgvs("podman", "f")
  ]) eq(argv[0], "setsid", JSON.stringify(argv.slice(0, 3)))

  // enter runs in a terminal and needs a controlling tty, which a new session
  // would take away. Listing and inspect are never cancelled.
  ok(Model.enterArgv("podman", "f").indexOf("setsid") === -1)
  ok(Model.listArgv("podman").indexOf("setsid") === -1)
  ok(Model.inspectHomesArgv("podman", ["f"]).indexOf("setsid") === -1)
})

test("killGroupArgv signals the group, and never the caller's own", () => {
  eq(Model.killGroupArgv(1857850), ["kill", "-TERM", "--", "-1857850"])
  // `kill -- -0` signals the CALLER's process group: the shell and every
  // other plugin's helpers. It must be impossible to build.
  for (const bad of [0, -1, undefined, null, "", NaN, Infinity, 1.5, "0", "$(id)"])
    eq(Model.killGroupArgv(bad), null, JSON.stringify(bad))
})

test("stop takes several names; rm is --force without --yes or --rm-home", () => {
  eq(Model.stopArgv("podman", ["a", "b"]), PREFIX.concat(["distrobox", "stop", "--yes", "a", "b"]))
  eq(Model.removeArgv("podman", "a"), PREFIX.concat(["distrobox", "rm", "--force", "a"]))
})

test("upgrade one or all, never with DBX_NON_INTERACTIVE (it would auto-create a missing box)", () => {
  eq(Model.upgradeArgv("podman", "a"), PREFIX.concat(["distrobox", "upgrade", "a"]))
  for (const bad of ["", null, undefined, "--all", "a b"]) eq(Model.upgradeArgv("podman", bad), null)
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
  const list = Model.listArgv("docker")
  eq(list.slice(0, 5), ["docker", "ps", "-a", "--no-trunc", "--filter"])
  eq(list[5], "label=manager=distrobox")
  eq(list[list.length - 1], Model.BOX_FORMAT)
  ok(Model.listArgv("podman").indexOf("-a") === 2)
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

// ---------------------------------------------------------------- promote

const SNIPPET = `programs.nixarchy.services.boxes.machines.t1 = {
  image = "quay.io/toolbx-images/debian-toolbox:12";
  # Add whatever else this box needs -- additional_packages, init_hooks,
  # exported_apps -- see distrobox-assemble's manual. This snippet only
  # knows what podman recorded for the image; nothing else about how
  # 't1' was set up by hand is knowable after the fact -- that is the
  # whole point of promoting it: from here on it is declared instead.
};`

test("promoteSnippet declares the box, naming the engine it came from", () => {
  eq(Model.promoteSnippet("t1", "quay.io/toolbx-images/debian-toolbox:12", "podman"), SNIPPET)
  eq(Model.promoteSnippet("t1", "quay.io/toolbx-images/debian-toolbox:12"), SNIPPET)
  ok(Model.promoteSnippet("t1", "docker.io/library/debian:12", "docker").indexOf("knows what docker recorded") !== -1)
})

test("promoteSnippet quotes a name that is not a plain Nix identifier", () => {
  const head = (n) => Model.promoteSnippet(n, "docker.io/library/debian:12").split("\n")[0]
  eq(head("t1"), "programs.nixarchy.services.boxes.machines.t1 = {")
  eq(head("dev-box_2"), "programs.nixarchy.services.boxes.machines.dev-box_2 = {")
  eq(head("my.box"), 'programs.nixarchy.services.boxes.machines."my.box" = {')
  eq(head("2box"), 'programs.nixarchy.services.boxes.machines."2box" = {')
  eq(head("in"), 'programs.nixarchy.services.boxes.machines."in" = {')
})

// Parsed by Nix itself when it is on PATH (not inside the flake check sandbox).
test("every promote snippet parses as Nix", () => {
  const { execFileSync } = require("child_process")
  try { execFileSync("nix-instantiate", ["--version"], { stdio: "ignore" }) } catch (e) { return }
  for (const n of ["t1", "my.box", "2box", "in", "a-b.c_d", "or"]) {
    const expr = "{ " + Model.promoteSnippet(n, "docker.io/library/debian:12", "docker") + " }"
    execFileSync("nix-instantiate", ["--parse", "--expr", expr], { stdio: "ignore" })
  }
})

test("a name or image the host would not survive gives null, never a snippet", () => {
  for (const bad of ["", "a b", '"; x = "', "t1\nx", "$(id)", "a}b", "${x}", "-rf", undefined, null]) {
    eq(Model.promoteSnippet(bad, "docker.io/library/debian:12"), null)
    eq(Model.promoteSnippet("t1", bad), null)
  }
})

test("copyTextArgv carries any text as one argv element", () => {
  eq(Model.copyTextArgv(SNIPPET), ["wl-copy", "--trim-newline", SNIPPET])
  for (const bad of ["", undefined, null, 7, ["x"]]) eq(Model.copyTextArgv(bad), null)
  eq(Model.copyArgv("t1"), ["wl-copy", "--trim-newline", "t1"])
})

test("upgrade all is one upgrade per box, and any bad name refuses the lot", () => {
  eq(Model.upgradeAllArgvs("docker", ["a", "b"]), [
    ["setsid", "env", "DBX_CONTAINER_MANAGER=docker", "distrobox", "upgrade", "a"],
    ["setsid", "env", "DBX_CONTAINER_MANAGER=docker", "distrobox", "upgrade", "b"]
  ])
  eq(Model.upgradeAllArgvs("podman", []), null)
  eq(Model.upgradeAllArgvs("podman", null), null)
  eq(Model.upgradeAllArgvs("podman", ["a", "$(id)"]), null)
})

test("upgradeSummary counts the boxes and names the ones that failed", () => {
  eq(Model.upgradeSummary([{ name: "a", code: 0 }, { name: "b", code: 0 }]), { text: "── upgraded 2 of 2", failed: [] })
  eq(Model.upgradeSummary([{ name: "a", code: 125 }, { name: "b", code: 0 }, { name: "c", code: 1 }]),
     { text: "── upgraded 1 of 3 · failed: a, c", failed: ["a", "c"] })
  eq(Model.upgradeSummary([{ name: "a", code: 1 }]), { text: "── upgraded 0 of 1 · failed: a", failed: ["a"] })
})

test("cancelTarget names the process that holds the lock, or nothing", () => {
  // A stream wins: upgrade and create hold the lock through streamProcess.
  eq(Model.cancelTarget(true, true, "upgrade t1", "", ""), { process: "stream", label: "upgrade t1" })
  // Streaming is enough on its own -- `mutating` already includes it.
  eq(Model.cancelTarget(false, true, "create t2 from fedora", "", ""),
     { process: "stream", label: "create t2 from fedora" })
  // Otherwise the action process, labelled by the pending verb and name.
  eq(Model.cancelTarget(true, false, "", "stopping", "t1"), { process: "action", label: "stopping t1" })
  // "stop every box" has a verb but no single name.
  eq(Model.cancelTarget(true, false, "", "stopping", ""), { process: "action", label: "stopping" })
  // Nothing running: nothing to cancel, so X is a no-op rather than an error.
  eq(Model.cancelTarget(false, false, "", "", ""), null)
  eq(Model.cancelTarget(false, false, "upgrade t1", "stopping", "t1"), null)
})

test("busyText names the operation and the key that gets the lock back", () => {
  eq(Model.busyText(true, "upgrade t1", "", ""), "Busy: upgrade t1 — press o to watch, K to cancel")
  eq(Model.busyText(false, "", "stopping", "t1"), "Busy: stopping t1 — K to cancel")
  eq(Model.busyText(false, "", "stopping", ""), "Busy: stopping — K to cancel")
})

