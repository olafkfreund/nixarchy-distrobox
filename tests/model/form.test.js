const { test, eq, ok, box, Model } = require("../harness.js")

const HOME = "/home/user"
const boxes = [
  box({ Names: "running1", ID: "r1", State: "running" }),
  box({ Names: "stopped1", ID: "s1", State: "exited", Status: "Exited (0) now" })
]
const form = (over) => Object.assign(Model.emptyForm(), { name: "t1" }, over || {})
const errors = (over) => Model.validateForm(form(over), boxes).errors

// Everything that means something to a shell. Each field is checked against
// the subset its quoting context lets through.
const HOSTILE = ["$(id)", "`id`", "a;b", "a|b", "a&b", "a>b", "a<b", "a'b", 'a"b', "a\\b", "a\nb", "${HOME}", "a b"]

test("emptyForm defaults to the Fedora toolbox and nothing switched on", () => {
  const f = Model.emptyForm()
  eq(f.image, Model.DEFAULT_IMAGE)
  ok(Object.keys(f).every(k => f[k] === false || typeof f[k] === "string"))
})

test("name is required, allowlisted and unique", () => {
  ok(errors({ name: "" }).name)
  ok(errors({ name: "running1" }).name)
  for (const bad of HOSTILE) ok(errors({ name: bad }).name, JSON.stringify(bad))
  eq(errors({}), {})
})

test("image is required, must be a reference, and a short name only warns", () => {
  ok(errors({ image: "" }).image)
  for (const bad of HOSTILE.concat(["UPPER/case", "quay.io/x:tag with space"])) ok(errors({ image: bad }).image, JSON.stringify(bad))
  for (const good of Model.IMAGES.map(i => i.value).concat(["localhost:5000/my-cool-image:1.0", "quay.io/a/b@sha256:" + "a".repeat(64)])) {
    eq(errors({ image: good }), {}, good)
  }
  const short = Model.validateForm(form({ image: "alpine" }), boxes)
  ok(short.ok)
  ok(short.warnings.image)
})

test("clone needs an existing, stopped box, and replaces --image", () => {
  ok(errors({ clone: "nope" }).clone)
  ok(errors({ clone: "running1" }).clone.indexOf("stop it first") !== -1)
  eq(errors({ clone: "stopped1", image: "" }), {})
  const argv = Model.createArgv(form({ clone: "stopped1" }), "podman", boxes, HOME)
  ok(argv.indexOf("--clone") !== -1)
  ok(argv.indexOf("--image") === -1)
})

test("hostname, platform and home have their own allowlists", () => {
  for (const bad of HOSTILE.concat(["-lead", "x".repeat(65)])) ok(errors({ hostname: bad }).hostname, JSON.stringify(bad))
  eq(errors({ hostname: "box.local" }), {})
  for (const bad of HOSTILE.concat(["linux", "Linux/amd64"])) ok(errors({ platform: bad }).platform, JSON.stringify(bad))
  eq(errors({ platform: "linux/arm64/v8" }), {})
  for (const bad of HOSTILE.concat(["relative/path", "~", "~user/x"])) ok(errors({ home: bad }).home, JSON.stringify(bad))
  eq(errors({ home: "~/.local/share/distrobox/t1" }), {})
})

test("volumes, packages and flags are token lists with no shell meaning", () => {
  // Whitespace, newlines included, only separates tokens; createArgv rebuilds
  // the value from the tokens, so a newline never reaches argv.
  const notSpace = HOSTILE.filter(s => s !== "a b" && s !== "a\nb")
  for (const bad of notSpace) {
    ok(errors({ volumes: "/a:" + bad }).volumes, "volumes " + JSON.stringify(bad))
    ok(errors({ additionalPackages: bad }).additionalPackages, "packages " + JSON.stringify(bad))
    ok(errors({ additionalFlags: "--x=" + bad }).additionalFlags, "flags " + JSON.stringify(bad))
  }
  ok(errors({ volumes: "/a:/b:rw,exec;id" }).volumes)
  const pasted = Model.createArgv(form({ additionalPackages: "git\ntmux\t vim" }), "podman", boxes, HOME)
  eq(pasted[pasted.indexOf("--additional-packages") + 1], "git tmux vim")
  ok(errors({ additionalFlags: "FOO=bar" }).additionalFlags)
  eq(errors({ volumes: "/srv:/srv ~/code:/code:ro,Z", additionalPackages: "git tmux g++ python3.12", additionalFlags: "--env=FOO=bar -q --device=/dev/kvm" }), {})
})

test("hooks may be shell for the box, but never break their host quoting", () => {
  for (const bad of ['a"b', "a\\b", "$(id)", "${HOME}", "`id`", "a\nb"]) ok(errors({ preInitHooks: bad }).preInitHooks, JSON.stringify(bad))
  eq(errors({ preInitHooks: "dnf -y install git && echo ok; touch /x" }), {})
  for (const bad of ["a'b", "a\nb"]) ok(errors({ initHooks: bad }).initHooks, JSON.stringify(bad))
  eq(errors({ initHooks: 'echo "$HOME" && ls | wc -l; `true`' }), {})
})

test("createArgv is null for an invalid form", () => {
  eq(Model.createArgv(form({ name: "$(id)" }), "podman", boxes, HOME), null)
  eq(Model.createArgv(form({ additionalFlags: "--x;id" }), "podman", boxes, HOME), null)
})

test("createArgv maps each switch to exactly its flag, and --unshare-all wins", () => {
  const base = Model.createArgv(form(), "podman", boxes, HOME)
  const flags = { pull: "--pull", init: "--init", nvidia: "--nvidia", noEntry: "--no-entry", unshareIpc: "--unshare-ipc" }
  for (const key in flags) {
    const argv = Model.createArgv(form({ [key]: true }), "podman", boxes, HOME)
    eq(argv.filter(a => base.indexOf(a) === -1), [flags[key]], key)
  }
  const all = Model.createArgv(form({ unshareAll: true, unshareIpc: true, unshareNetns: true }), "podman", boxes, HOME)
  eq(all.filter(a => a.indexOf("--unshare") === 0), ["--unshare-all"])
})

test("a full form round-trips to the documented argv, with ~ expanded", () => {
  const argv = Model.createArgv(form({
    image: "quay.io/toolbx/ubuntu-toolbox:24.04",
    hostname: "t1",
    pull: true,
    home: "~/.local/share/distrobox/t1",
    volumes: "~/code:/code:ro  /srv:/srv",
    additionalFlags: "--env=A=1  --device=/dev/kvm",
    additionalPackages: "git  tmux",
    initHooks: "echo 'hi'".replace(/'/g, ""),
    preInitHooks: "true",
    init: true,
    nvidia: true,
    platform: "linux/amd64",
    unshareNetns: true,
    noEntry: true
  }), "docker", boxes, HOME)
  eq(argv, [
    "env", "DBX_CONTAINER_MANAGER=docker", "distrobox", "create", "--yes",
    "--name", "t1",
    "--image", "quay.io/toolbx/ubuntu-toolbox:24.04",
    "--hostname", "t1",
    "--pull",
    "--home", "/home/user/.local/share/distrobox/t1",
    "--volume", "/home/user/code:/code:ro",
    "--volume", "/srv:/srv",
    "--additional-flags", "--env=A=1 --device=/dev/kvm",
    "--additional-packages", "git tmux",
    "--init-hooks", "echo hi",
    "--pre-init-hooks", "true",
    "--init",
    "--nvidia",
    "--platform", "linux/amd64",
    "--unshare-netns",
    "--no-entry"
  ])
})

test("imagesMatching filters the curated list", () => {
  eq(Model.imagesMatching("").length, Model.IMAGES.length)
  ok(Model.imagesMatching("ubuntu").every(i => /ubuntu/i.test(i.value + i.label)))
  eq(Model.imagesMatching("zzz"), [])
})

test("formSummary names the source", () => {
  eq(Model.formSummary(form()), "create t1 from " + Model.DEFAULT_IMAGE)
  eq(Model.formSummary(form({ clone: "stopped1" })), "create t1 from clone of stopped1")
})
