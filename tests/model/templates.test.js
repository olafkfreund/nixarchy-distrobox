const { test, eq, ok, Model } = require("../harness.js")

const form = (over) => Object.assign(Model.emptyForm(), over || {})

test("templateChoices puts Blank first and filters", () => {
  const all = Model.templateChoices("")
  eq(all[0].id, "")
  eq(all[0].label, "Blank")
  eq(all.map(t => t.id).slice(1), ["fedora", "ubuntu", "debian", "arch"])
  eq(Model.templateChoices("deb").map(t => t.id), ["debian"])
  eq(Model.templateChoices("toolbx").map(t => t.id), ["ubuntu", "debian", "arch"])
})

test("applyTemplate fills image, packages and home, and keeps the name", () => {
  const got = Model.applyTemplate(form({ name: "dev", clone: "old" }), "ubuntu")
  eq(got.name, "dev")
  eq(got.template, "ubuntu")
  eq(got.image, "quay.io/toolbx/ubuntu-toolbox:24.04")
  eq(got.additionalPackages, "")
  eq(got.home, "~/.local/share/distrobox/dev")
  eq(got.clone, "")
})

test("applyTemplate adds the init packages only while Init is on", () => {
  eq(Model.applyTemplate(form({ name: "d", init: true }), "debian").additionalPackages,
     "systemd libpam-systemd pipewire-audio-client-libraries")
  eq(Model.applyTemplate(form({ name: "f", init: true }), "fedora").additionalPackages, "systemd")
})

test("applyTemplate leaves home empty without a valid name", () => {
  eq(Model.applyTemplate(form({ name: "" }), "arch").home, "")
  eq(Model.applyTemplate(form({ name: "bad name" }), "arch").home, "")
})

test("Blank puts image, packages and home back to the defaults, keeping the name", () => {
  const filled = Model.applyTemplate(form({ name: "dev", init: true }), "ubuntu")
  const blank = Model.applyTemplate(filled, "")
  eq(blank.name, "dev")
  eq(blank.template, "")
  eq(blank.image, Model.DEFAULT_IMAGE)
  eq(blank.additionalPackages, "")
  eq(blank.home, "")
})

test("setInit adds and removes exactly the template's init tokens", () => {
  let f = Model.applyTemplate(form({ name: "u", additionalPackages: "git" }), "ubuntu")
  eq(f.additionalPackages, "")
  f = Object.assign({}, f, { additionalPackages: "git tmux" })
  f = Model.setInit(f, true)
  eq(f.additionalPackages, "git tmux systemd libpam-systemd pipewire-audio-client-libraries")
  f = Model.setInit(f, false)
  eq(f.additionalPackages, "git tmux")
  eq(f.init, false)
})

test("setInit without a template only flips the switch", () => {
  const f = Model.setInit(form({ additionalPackages: "systemd git" }), false)
  eq(f.additionalPackages, "systemd git")
  eq(Model.setInit(form(), true).additionalPackages, "")
})

test("switching templates with Init on does not keep the old template's init packages", () => {
  let f = Model.applyTemplate(form({ name: "x", init: true }), "debian")
  f = Model.applyTemplate(f, "arch")
  eq(f.additionalPackages, "systemd")
})

test("every template passes the form's own checks", () => {
  for (const t of Model.TEMPLATES) {
    ok(Model.isImageRef(t.image), t.id + " image")
    ok(!Model.isShortName(t.image), t.id + " fully qualified")
    ok(Model.isPackageList(t.packages) && Model.isPackageList(t.initPackages), t.id + " packages")
    for (const init of [false, true]) {
      const f = Model.applyTemplate(form({ name: "tpl-" + t.id, init }), t.id)
      eq(Model.validateForm(f, []).errors, {}, t.id + " init=" + init)
    }
  }
})

test("the template choice never reaches argv", () => {
  const f = Model.applyTemplate(form({ name: "dev" }), "fedora")
  const argv = Model.createArgv(f, "podman", [], "/home/user")
  ok(argv.every(a => a.indexOf("fedora") === -1 || a.indexOf("registry.fedoraproject.org") === 0))
  ok(argv.indexOf("--template") === -1)
  eq(Model.emptyForm().template, "")
})

test("the Start from field sits right after Name", () => {
  eq(Model.FORM_FIELDS[0].key, "name")
  eq(Model.FORM_FIELDS[1].key, "template")
  eq(Model.FORM_FIELDS[1].kind, "template")
})
