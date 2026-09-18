const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
    .replace(/^\s*\.pragma\s+library\s*$/m, "")

  const before = new Set(Object.getOwnPropertyNames(globalThis))
  vm.runInThisContext(source, { filename: file })

  const namespace = {}
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!before.has(name)) namespace[name] = globalThis[name]
  }
  return namespace
}

const Model = load("Model.js")

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push({ name: name, error: error })
  }
}

function report() {
  for (const failure of failures) {
    console.error("FAIL  " + failure.name)
    console.error("      " + String(failure.error.message).split("\n").join("\n      "))
  }
  console.log(`${passed} passed, ${failures.length} failed`)
  return failures.length === 0 ? 0 : 1
}

const HOST_HOME = "/home/user"

// A line of `podman ps --format BOX_FORMAT`, as captured on podman 5.8.
function psRow(overrides) {
  return Object.assign({
    ID: "09b5a26202c0836983eba2b43b75aad787fafc822207218e277e7e2cb9a098a6",
    Names: "fedora",
    Image: "registry.fedoraproject.org/fedora-toolbox:latest",
    State: "running",
    Status: "Up 1 second"
  }, overrides || {})
}

// The same line from docker 29, which can carry link aliases in Names.
function dockerRow(overrides) {
  return Object.assign({
    ID: "e2bc1d81ad7d91d3f15a938f4fbe4beb2ba7ed58923b5d858de77697986ad25e",
    Names: "ubuntu",
    Image: "docker.io/library/ubuntu:24.04",
    State: "exited",
    Status: "Exited (0) 3 days ago"
  }, overrides || {})
}

function box(overrides, homes) {
  return Model.normalizeBox(psRow(overrides), homes || {}, HOST_HOME)
}

module.exports = {
  test: test,
  eq: assert.deepStrictEqual,
  ok: assert.ok,
  report: report,
  psRow: psRow,
  dockerRow: dockerRow,
  box: box,
  HOST_HOME: HOST_HOME,
  Model: Model
}
