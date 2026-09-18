const { test, eq, ok, Model } = require("../harness.js")

const one = (text, name) => {
  const all = Model.fileTemplates(text).templates
  return name ? all.find(t => t.label === name) : all[0]
}

test("line rules follow distrobox-assemble's parse_file", () => {
  const p = Model.parseAssemble([
    "# a comment line",
    "[fedora] # trailing comment on a header",
    "image=registry.fedoraproject.org/fedora-toolbox:latest # inline comment",
    "\thome=\"~/.local/share/distrobox/fedora\"   ",
    "",
    "additional packages=git",
    "init=true",
    "nvidia=false",
    "additional_flags=--env=A=1",
  ].join("\n"))
  eq(p.sections.map(s => s.name), ["fedora"])
  const kv = Object.fromEntries(p.sections[0].lines.map(l => [l.key, l.value]))
  eq(kv.image, "registry.fedoraproject.org/fedora-toolbox:latest")
  eq(kv.home, "~/.local/share/distrobox/fedora")          // one pair of quotes stripped
  eq(kv.additionalpackages, "git")                           // spaces removed from the key
  eq(kv.init, "1")
  eq(kv.nvidia, "0")
  eq(kv.additional_flags, "--env=A=1")                        // split at the first = only
})

test("lines outside a section, and lines without =, are reported", () => {
  const p = Model.parseAssemble("image=x\n[a]\njunkline\nimage=y")
  ok(p.errors[0].indexOf("outside any [section]") !== -1)
  ok(p.sections[0].errors[0].indexOf("no key=value") !== -1)
  eq(one("[a]\njunkline\nimage=quay.io/a/b:1").usable, false)
})

test("repeated keys accumulate: volumes, packages, flags and hooks", () => {
  const t = one([
    "[dev]", "image=quay.io/toolbx/ubuntu-toolbox:24.04",
    "volume=/srv:/srv", "volume=~/code:/code:ro",
    "additional_packages=git tmux", "additional_packages=vim",
    "init_hooks=echo a", "init_hooks=echo b;", "init_hooks=echo c &&", "init_hooks=echo d",
    "pre_init_hooks=echo pre",
  ].join("\n"))
  eq(t.form.volumes, "/srv:/srv ~/code:/code:ro")
  eq(t.form.additionalPackages, "git tmux vim")
  eq(t.form.initHooks, "echo a; echo b; echo c && echo d")
  eq(t.form.preInitHooks, "echo pre")
  ok(t.usable, t.reasons.join(", "))
})

test("like upstream, true/false become 1/0 for every key, hooks included", () => {
  // distrobox-assemble normalises before it looks at the key, so a hook of
  // exactly "true" runs as the command "1". Mirrored, not corrected, so the
  // form shows what distrobox would do with the same file.
  eq(one("[a]\nimage=quay.io/toolbx/arch-toolbox:latest\npre_init_hooks=true").form.preInitHooks, "1")
})

test("booleans map onto the form, entry=false means no entry", () => {
  const t = one("[b]\nimage=quay.io/toolbx/arch-toolbox:latest\ninit=true\npull=true\nnvidia=true\nentry=false\nunshare_netns=true\nunshare_all=false")
  eq([t.form.init, t.form.pull, t.form.nvidia, t.form.noEntry, t.form.unshareNetns, t.form.unshareAll], [true, true, true, true, true, false])
})

test("include inlines another section, nested", () => {
  const text = "[base]\nimage=quay.io/toolbx/ubuntu-toolbox:24.04\ninclude=pkgs\n[pkgs]\nadditional_packages=git\n[dev]\ninclude=base\nhome=~/boxes/dev"
  const t = one(text, "dev")
  eq(t.form.image, "quay.io/toolbx/ubuntu-toolbox:24.04")
  eq(t.form.additionalPackages, "git")
  eq(t.form.home, "~/boxes/dev")
  ok(t.usable, t.reasons.join(", "))
})

test("circular, missing and over-deep includes make the section unusable", () => {
  ok(one("[a]\ninclude=b\n[b]\ninclude=a", "a").reasons.some(r => r.indexOf("circular") !== -1))
  ok(one("[a]\ninclude=nope", "a").reasons.some(r => r.indexOf("not found") !== -1))
  const deep = Array.from({ length: 12 }, (_, i) => `[s${i}]\ninclude=s${i + 1}`).join("\n") + "\n[s12]\nimage=quay.io/a/b:1"
  ok(one(deep, "s0").reasons.some(r => r.indexOf("deeper") !== -1))
})

test("refused keys: exported_*, root, replace, unknown, a key set twice, a non-boolean", () => {
  const img = "image=quay.io/toolbx/arch-toolbox:latest"
  for (const [line, word] of [["exported_apps=firefox", "exported_apps"], ["exported_bins=/usr/bin/x", "exported_bins"],
      ["root=true", "root"], ["replace=true", "replace"], ["platform=linux/amd64", "unknown"], ["colour=red", "unknown"],
      ["image=quay.io/x/y:1", "more than once"], ["init = true", "true or false"]]) {
    const t = one(`[a]\n${img}\n${line}`)
    ok(!t.usable, line)
    ok(t.reasons.some(r => r.indexOf(word) !== -1), line + " -> " + t.reasons.join(" | "))
  }
  ok(one(`[a]\n${img}\nroot=false\nreplace=false`).usable)
})

test("start_now and name are noted and ignored", () => {
  const t = one("[a]\nimage=quay.io/toolbx/arch-toolbox:latest\nstart_now=true\nname=other")
  ok(t.usable)
  eq(t.form.name, "a")
  eq(t.notes.length, 2)
})

test("hostile values never pass, and are never altered", () => {
  const hostile = [
    ["image=$(touch /tmp/pwned)", "image"],
    ["image=quay.io/a/b:1;id", "image"],
    ["home=~/x`id`", "home"],
    ["hostname=$(id)", "hostname"],
    ["volume=/a:/b;id", "volumes"],
    ["additional_packages=git;id", "additionalPackages"],
    ["additional_flags=--x=$(id)", "additionalFlags"],
    ["init_hooks=echo 'x'", "initHooks"],
    ["pre_init_hooks=echo $HOME", "preInitHooks"],
  ]
  for (const [line, field] of hostile) {
    const base = line.startsWith("image=") ? "" : "image=quay.io/toolbx/arch-toolbox:latest\n"
    const t = one(`[a]\n${base}${line}`)
    ok(!t.usable, line)
    ok(t.reasons.some(r => r.indexOf(field) === 0), line + " -> " + t.reasons.join(" | "))
    const raw = line.substring(line.indexOf("=") + 1)
    ok(Object.values(t.form).some(v => String(v).indexOf(raw.replace(/'/g, "'")) !== -1 || String(v) === raw), "raw kept: " + line)
  }
})

test("an invalid section name is unusable", () => {
  // Upstream strips spaces from section names, so this one becomes "badname".
  eq(one("[bad name]\nimage=quay.io/toolbx/arch-toolbox:latest").label, "badname")
  const t = one("[b$(id)]\nimage=quay.io/toolbx/arch-toolbox:latest")
  ok(!t.usable)
})

test("size and line bounds", () => {
  eq(Model.fileTemplates("x".repeat(70000)).errors[0], "the file is larger than 64 KB")
  const many = "[a]\nimage=quay.io/toolbx/arch-toolbox:latest\n" + Array.from({ length: 300 }, () => "volume=/a:/a").join("\n")
  ok(one(many).reasons.some(r => r.indexOf("more than 256") !== -1))
})

test("a realistic file like the owner's wrapper boxes", () => {
  const text = [
    "[fedora]", "image=quay.io/fedora/fedora:42", "home=~/.local/share/distrobox/Fedora",
    "[ubuntu]", "image=docker.io/library/ubuntu:25.04", "home=~/.local/share/distrobox/Ubuntu", "additional_packages=git build-essential",
  ].join("\n")
  const all = Model.fileTemplates(text).templates
  eq(all.map(t => [t.label, t.usable]), [["fedora", true], ["ubuntu", true]])
  eq(all[1].form.additionalPackages, "git build-essential")
  const argv = Model.createArgv(all[0].form, "podman", [], "/home/user")
  ok(argv.indexOf("--image") !== -1 && argv[argv.indexOf("--image") + 1] === "quay.io/fedora/fedora:42")
  eq(argv[argv.indexOf("--home") + 1], "/home/user/.local/share/distrobox/Fedora")
})

test("templateChoices lists file entries after the built-ins; applyFileTemplate keeps a typed name", () => {
  const files = Model.fileTemplates("[mine]\nimage=quay.io/toolbx/arch-toolbox:latest").templates
  const ids = Model.templateChoices("", files).map(t => t.id)
  eq(ids[0], "")
  eq(ids[ids.length - 1], "file:mine")
  eq(Model.applyFileTemplate(Object.assign(Model.emptyForm(), { name: "typed" }), files[0]).name, "typed")
  eq(Model.applyFileTemplate(Model.emptyForm(), files[0]).name, "mine")
  const bad = Model.fileTemplates("[x]\nimage=$(id)").templates[0]
  const before = Object.assign(Model.emptyForm(), { name: "keep" })
  eq(Model.applyFileTemplate(before, bad), before)
})
