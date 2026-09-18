.pragma library

// All of the plugin's logic. No QML in here: this file runs under plain Node
// in tests/, and the QML side only draws and wires.

var Glyph = {
  box: String.fromCodePoint(0xF01A7),
  play: String.fromCodePoint(0xF040A),
  stop: String.fromCodePoint(0xF04DB),
  restart: String.fromCodePoint(0xF0709),
  enter: String.fromCodePoint(0xF018D),
  upgrade: String.fromCodePoint(0xF06B0),
  logs: String.fromCodePoint(0xF0219),
  copy: String.fromCodePoint(0xF018F),
  refresh: String.fromCodePoint(0xF0450),
  search: String.fromCodePoint(0xF0349),
  remove: String.fromCodePoint(0xF0A7A),
  plus: String.fromCodePoint(0xF0415),
  alert: String.fromCodePoint(0xF002A),
  close: String.fromCodePoint(0xF0156),
  keyboard: String.fromCodePoint(0xF030C)
}

var MAX_FIELD = 64

// ---------------------------------------------------------------- keys
//
// The one list of what the keyboard does. The `?` sheet renders it and the
// docs quote it, so the two cannot drift apart.

var SHORTCUTS = [
  { group: "Move", keys: "j  k  ↑ ↓", text: "Move the cursor down / up" },
  { group: "Move", keys: "/", text: "Jump into the filter box" },
  { group: "Move", keys: "k  ↑", text: "From the first row, step back up into the filter" },
  { group: "Move", keys: "esc", text: "Leave the filter, then close the panel" },

  { group: "Box", keys: "enter  e", text: "Enter the box in a terminal" },
  { group: "Box", keys: "s", text: "Start it (waits for its setup) or stop it" },
  { group: "Box", keys: "r", text: "Restart it" },
  { group: "Box", keys: "g", text: "Upgrade its packages, with the log in the panel" },
  { group: "Box", keys: "x", text: "Delete it (its home directory is kept)" },
  { group: "Box", keys: "y", text: "Copy its name" },

  { group: "All boxes", keys: "c", text: "Create a new box" },
  { group: "All boxes", keys: "U", text: "Upgrade every box" },
  { group: "All boxes", keys: "S", text: "Stop every running box" },

  { group: "Panel", keys: "o", text: "Show the create / upgrade log" },
  { group: "Panel", keys: "u", text: "Refresh now" },
  { group: "Panel", keys: "?", text: "Show this list" },

  { group: "Create form", keys: "tab  ↓ / shift+tab  ↑", text: "Next / previous field" },
  { group: "Create form", keys: "space", text: "Flip a switch, open Advanced" },
  { group: "Create form", keys: "enter", text: "Create the box" },
  { group: "Create form", keys: "esc", text: "Cancel" },

  { group: "Log", keys: "j  k", text: "Scroll (stops following)" },
  { group: "Log", keys: "G  end", text: "Jump to the end and follow" },
  { group: "Log", keys: "esc", text: "Back to the list; the job keeps running" }
]

function shortcutGroups() {
  var order = []
  var byGroup = {}
  for (var i = 0; i < SHORTCUTS.length; i++) {
    var entry = SHORTCUTS[i]
    if (!byGroup[entry.group]) {
      byGroup[entry.group] = []
      order.push(entry.group)
    }
    byGroup[entry.group].push({ keys: entry.keys, text: entry.text })
  }
  var out = []
  for (var g = 0; g < order.length; g++) {
    out.push({ title: order[g], entries: byGroup[order[g]] })
  }
  return out
}

// ---------------------------------------------------------------- text

function sanitize(value, maxLength) {
  var text = String(value === undefined || value === null ? "" : value)
  var limit = maxLength > 0 ? maxLength : MAX_FIELD
  var out = ""
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F)) continue
    out += text.charAt(i)
  }
  out = out.replace(/^\s+|\s+$/g, "")
  if (out.length > limit) out = out.substring(0, limit - 1) + "…"
  return out
}

function trim(value) {
  return String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
}

function join(parts, separator) {
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] !== undefined && parts[i] !== null && String(parts[i]) !== "") out.push(String(parts[i]))
  }
  return out.join(separator === undefined ? " · " : separator)
}

function plural(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "es")
}

// Terminal output from a package manager: colour codes, cursor moves, and
// progress bars that redraw themselves with \r. Keep what the last redraw
// left on the line, drop every escape sequence.
function stripAnsi(line) {
  var text = String(line === undefined || line === null ? "" : line)
  var cr = text.lastIndexOf("\r", text.length - 2)
  if (cr !== -1) text = text.substring(cr + 1)
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
}

var LINE_CAP = 2048

// ponytail: a line longer than 2 KB is a progress bar or a binary blob, not
// something to read; cut it rather than let one line grow the log unbounded.
function capLine(line) {
  var text = String(line === undefined || line === null ? "" : line)
  return text.length > LINE_CAP ? text.substring(0, LINE_CAP - 1) + "…" : text
}

// ---------------------------------------------------------------- identifiers

function isContainerId(value) {
  return /^[A-Za-z0-9]{1,128}$/.test(String(value || ""))
}

// distrobox passes the name straight to the engine, and podman and docker
// both accept [a-zA-Z0-9][a-zA-Z0-9_.-]*. 63 keeps it usable as a hostname.
function isBoxName(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(String(value === undefined || value === null ? "" : value))
}

// Docker reports "/name" from inspect, and `ps` can list legacy link aliases
// as "name,other/alias". The first entry, without its slash, is the box.
function normalizeName(value) {
  var first = trim(String(value === undefined || value === null ? "" : value).split(",")[0])
  return first.replace(/^\//, "")
}

function shortId(value) {
  var text = trim(value).replace(/^sha256:/, "")
  return text.length > 12 ? text.substring(0, 12) : text
}

// ---------------------------------------------------------------- parsing

// What the list asks the engine for. Podman and docker both render these five
// fields as plain JSON strings, one object per line.
var BOX_FORMAT = '{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}}}'

// One line per box: its name, a tab, and the HOME distrobox gave it. Read the
// same way distrobox-rm reads it, from the container's environment.
var HOME_FORMAT = '{{.Name}}\t{{range .Config.Env}}{{if and (ge (len .) 5) (eq (slice . 0 5) "HOME=")}}{{slice . 5}}{{end}}{{end}}'

function parseJsonLines(raw) {
  var lines = String(raw || "").split("\n")
  var out = []
  for (var i = 0; i < lines.length; i++) {
    var line = trim(lines[i])
    if (line.charAt(0) !== "{") continue
    try {
      out.push(JSON.parse(line))
    } catch (e) {
    }
  }
  return out
}

function parseHomes(raw) {
  var out = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var tab = lines[i].indexOf("\t")
    if (tab === -1) continue
    var name = normalizeName(lines[i].substring(0, tab))
    var home = trim(lines[i].substring(tab + 1))
    if (isBoxName(name) && home) out[name] = home
  }
  return out
}

function homeLabel(home, hostHome) {
  var value = trim(home)
  var host = trim(hostHome).replace(/\/+$/, "")
  if (!value) return ""
  if (host && value === host) return "~"
  if (host && value.indexOf(host + "/") === 0) return "~" + value.substring(host.length)
  return value
}

function shortImage(image) {
  var value = trim(image)
  if (!value) return ""
  if (value.indexOf("sha256:") === 0) return value.substring(0, 19)
  var slash = value.indexOf("/")
  if (slash > 0) {
    var host = value.substring(0, slash)
    if (host.indexOf(".") !== -1 || host.indexOf(":") !== -1 || host === "localhost") {
      value = value.substring(slash + 1)
    }
  }
  return value
}

function exitCode(status) {
  var match = String(status || "").match(/^Exited \((\d+)\)/)
  return match ? parseInt(match[1], 10) : -1
}

function normalizeBox(raw, homes, hostHome) {
  var name = normalizeName(raw && raw.Names)
  var state = trim(raw && raw.State).toLowerCase()
  var status = sanitize(raw && raw.Status, 64)
  var code = exitCode(status)
  var home = homes && homes[name] ? homes[name] : ""
  var image = sanitize(raw && raw.Image, 160)
  return {
    id: shortId(raw && raw.ID),
    name: name,
    image: image,
    shortImage: shortImage(image),
    state: state,
    status: status,
    up: state === "running",
    exitCode: code,
    failing: state !== "running" && code > 0,
    home: home,
    homeLabel: homeLabel(home, hostHome),
    search: (name + " " + image).toLowerCase()
  }
}

// A row whose id or name would not survive an argv slot is not a box we can
// act on, so it never reaches the list.
function normalizeBoxes(rawList, homes, hostHome) {
  var out = []
  var list = rawList || []
  for (var i = 0; i < list.length; i++) {
    var box = normalizeBox(list[i], homes, hostHome)
    if (isContainerId(box.id) && isBoxName(box.name)) out.push(box)
  }
  return out
}

function boxNames(boxes) {
  var out = []
  for (var i = 0; i < (boxes || []).length; i++) out.push(boxes[i].name)
  return out
}

function boxByName(boxes, name) {
  for (var i = 0; i < (boxes || []).length; i++) {
    if (boxes[i].name === name) return boxes[i]
  }
  return null
}

// ---------------------------------------------------------------- list

function compareBoxes(a, b) {
  if (a.up !== b.up) return a.up ? -1 : 1
  if (a.failing !== b.failing) return a.failing ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function sortBoxes(boxes) {
  return (boxes || []).slice().sort(compareBoxes)
}

function filterBoxes(boxes, query) {
  var q = trim(query).toLowerCase()
  if (!q) return (boxes || []).slice()
  var out = []
  for (var i = 0; i < (boxes || []).length; i++) {
    if (boxes[i].search.indexOf(q) !== -1) out.push(boxes[i])
  }
  return out
}

var ROW_FIELDS = ["name", "subtitle", "status", "image", "home", "up", "failing"]

var ROW_BOOLEANS = ["up", "failing"]

// A ListModel takes its role types from the first object it is handed and
// drops any field it cannot type, so hand it a fresh plain object with every
// field present and explicitly typed.
function rowRecord(row) {
  var out = { key: String(row.key), id: String(row.id) }
  for (var i = 0; i < ROW_FIELDS.length; i++) {
    var field = ROW_FIELDS[i]
    var value = row[field]
    out[field] = ROW_BOOLEANS.indexOf(field) !== -1
      ? value === true
      : String(value === undefined || value === null ? "" : value)
  }
  return out
}

function statusText(box) {
  if (!box) return ""
  if (box.up) return box.status
  if (box.exitCode > 0) return "Exited (" + box.exitCode + ")"
  return box.status || box.state
}

function rowsFor(boxes) {
  var out = []
  var sorted = sortBoxes(boxes)
  for (var i = 0; i < sorted.length; i++) {
    var box = sorted[i]
    out.push({
      key: box.name,
      id: box.id,
      name: box.name,
      subtitle: join([box.shortImage, box.homeLabel]),
      status: statusText(box),
      image: box.image,
      home: box.home,
      up: box.up,
      failing: box.failing
    })
  }
  return out
}

function clampCursor(cursorIndex, total) {
  if (total <= 0) return 0
  if (cursorIndex < 0) return 0
  if (cursorIndex > total - 1) return total - 1
  return cursorIndex
}

// The smallest list of ListModel operations that turns currentKeys into the
// keys of nextRows, so rows the cursor is on are moved rather than rebuilt.
function reconcilePlan(currentKeys, nextRows) {
  var keys = (currentKeys || []).slice()
  var next = nextRows || []
  var ops = []

  var wanted = {}
  for (var i = 0; i < next.length; i++) wanted[next[i].key] = true

  for (var r = keys.length - 1; r >= 0; r--) {
    if (wanted[keys[r]]) continue
    ops.push({ op: "remove", index: r })
    keys.splice(r, 1)
  }

  for (var n = 0; n < next.length; n++) {
    if (keys[n] === next[n].key) continue
    var found = keys.indexOf(next[n].key, n)
    if (found > n) {
      ops.push({ op: "move", from: found, to: n })
      keys.splice(n, 0, keys.splice(found, 1)[0])
    } else {
      ops.push({ op: "insert", index: n, row: next[n] })
      keys.splice(n, 0, next[n].key)
    }
  }
  return ops
}

// ---------------------------------------------------------------- summaries

function counts(boxes) {
  var list = boxes || []
  var out = { total: list.length, running: 0, stopped: 0, failing: 0 }
  for (var i = 0; i < list.length; i++) {
    if (list[i].up) out.running++
    else out.stopped++
    if (list[i].failing) out.failing++
  }
  return out
}

function summaryText(boxes, reachable, engine) {
  if (!reachable) return (engine || "podman") + " unreachable"
  var c = counts(boxes)
  if (c.total === 0) return "No boxes"
  return c.running + " of " + c.total + " running"
}

function footerText(boxes) {
  var c = counts(boxes)
  return plural(c.total, "box") + " · " + c.running + " running"
}

// The one line shown when there is nothing to list. Says why.
function emptyText(state) {
  if (!state.everLoaded) return "Loading…"
  if (!state.reachable) return (state.engine || "podman") + " unreachable"
  if (state.filtered) return "Nothing matches that filter"
  if (!state.showStopped) return "No running boxes"
  return "No boxes yet — press c to create one"
}

// The engine's or distrobox's own error text, cut to the one line that says
// something.
function errorText(raw) {
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = trim(stripAnsi(lines[i])).replace(/^Error(?: response from daemon)?:\s*/i, "")
    if (line) return sanitize(line, 160)
  }
  return ""
}

// ---------------------------------------------------------------- settings

// The menu entry point is not a bar widget, so it has no setting(). It reads
// the widget's entry out of the bar layout instead: `bar.layout.<region>[]`,
// where an entry is either a bare id or {id, ...settings}. Only keys the
// defaults know about, carrying the same type, get through.
function settingsFor(barConfig, id, defaults) {
  var result = {}
  for (var key in defaults) result[key] = defaults[key]
  if (!barConfig || typeof barConfig !== "object") return result
  var layout = barConfig.layout && typeof barConfig.layout === "object" ? barConfig.layout : barConfig
  var regions = ["left", "center", "right"]
  for (var r = 0; r < regions.length; r++) {
    // Not Array.isArray: read through a QObject property, the layout's lists
    // are Qt sequence wrappers, which have a length but are not JS arrays.
    var list = layout[regions[r]]
    var entries = list && typeof list === "object" && typeof list.length === "number" ? list : []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (!entry || typeof entry !== "object" || entry.id !== id) continue
      for (var k in result) {
        if (k in entry && typeof entry[k] === typeof result[k]) result[k] = entry[k]
      }
      return result
    }
  }
  return result
}

// ---------------------------------------------------------------- engine

var ENGINES = ["podman", "docker"]

// The engine never comes from anything a user typed into a field: anything
// but exactly "docker" is podman, the distrobox default on this desktop.
function engineFor(value) {
  return value === "docker" ? "docker" : "podman"
}

// Every distrobox call starts here. distrobox honours DBX_CONTAINER_MANAGER in
// enter, stop, rm, create and upgrade; without it, autodetection prefers
// podman, and a docker user's `x` could delete a podman box of the same name.
function dbx(engine) {
  return ["env", "DBX_CONTAINER_MANAGER=" + engineFor(engine)]
}

// ---------------------------------------------------------------- commands
//
// Argv arrays only. Each returns null when an input would not be safe in its
// slot, and the caller does nothing.

function listArgv(engine, showStopped) {
  var argv = [engineFor(engine), "ps"]
  if (showStopped !== false) argv.push("-a")
  return argv.concat(["--no-trunc", "--filter", "label=manager=distrobox", "--format", BOX_FORMAT])
}

function allNames(names) {
  var list = names || []
  if (list.length === 0) return false
  for (var i = 0; i < list.length; i++) {
    if (!isBoxName(list[i])) return false
  }
  return true
}

function inspectHomesArgv(engine, names) {
  if (!allNames(names)) return null
  return [engineFor(engine), "inspect", "--type", "container", "--format", HOME_FORMAT].concat(names)
}

// Runs inside a terminal. distrobox enter waits for the box's first-run setup
// itself, so a freshly created box can be entered straight away.
function enterArgv(engine, name) {
  if (!isBoxName(name)) return null
  return ["omarchy-launch-tui", "--app-id=org.omarchy.distrobox-enter"]
    .concat(dbx(engine), ["distrobox", "enter", name])
}

// Not `<engine> start`: that returns while distrobox-init is still setting the
// box up, and `ps` already says running. `enter -T -- true` starts the box the
// way distrobox does, waits for the setup to finish, then exits.
function startArgv(engine, name) {
  if (!isBoxName(name)) return null
  return dbx(engine).concat(["distrobox", "enter", "--name", name, "-T", "--", "true"])
}

function stopArgv(engine, names) {
  if (!allNames(names)) return null
  return dbx(engine).concat(["distrobox", "stop", "--yes"], names)
}

// Two commands, run back to back under one lock.
function restartArgvs(engine, name) {
  if (!isBoxName(name)) return null
  return [stopArgv(engine, [name]), startArgv(engine, name)]
}

// --force already makes distrobox rm non-interactive. No --rm-home: the box's
// home directory is kept, and the confirm dialog says so.
function removeArgv(engine, name) {
  if (!isBoxName(name)) return null
  return dbx(engine).concat(["distrobox", "rm", "--force", name])
}

function upgradeArgv(engine, name) {
  var target = name === null || name === undefined || name === "" ? "--all" : name
  if (target !== "--all" && !isBoxName(target)) return null
  return dbx(engine).concat(["DBX_NON_INTERACTIVE=1", "distrobox", "upgrade", target])
}

function copyArgv(name) {
  if (!isBoxName(name)) return null
  return ["wl-copy", "--trim-newline", name]
}

// ---------------------------------------------------------------- row actions

function action(verb, glyph, tooltip, danger, enabled) {
  return { verb: verb, glyph: glyph, tooltip: tooltip, danger: danger === true, enabled: enabled !== false }
}

// `lock` is {mutating}. While anything mutates, only entering stays open:
// entering never changes the box, and it waits for any setup on its own.
function actionsFor(row, lock) {
  if (!row) return []
  var free = !(lock && lock.mutating)
  var out = [action("enter", Glyph.enter, "Enter in a terminal  (enter)", false, true)]
  if (row.up) {
    out.push(action("restart", Glyph.restart, "Restart  (r)", false, free))
    out.push(action("stop", Glyph.stop, "Stop  (s)", true, free))
  } else {
    out.push(action("start", Glyph.play, "Start  (s)", false, free))
  }
  out.push(action("upgrade", Glyph.upgrade, "Upgrade packages  (g)", false, free))
  out.push(action("remove", Glyph.remove, "Delete  (x)", true, free))
  return out
}

function allowsVerb(row, verb, lock) {
  var actions = actionsFor(row, lock)
  for (var i = 0; i < actions.length; i++) {
    if (actions[i].verb === verb) return actions[i].enabled
  }
  return false
}

function removeMessage(box, hostHome) {
  if (!box) return ""
  var home = box.home && box.home !== trim(hostHome).replace(/\/+$/, "")
    ? "Its home directory " + box.home + " is kept."
    : "It shares your home directory, which is not touched."
  return "Delete the box “" + box.name + "”? " + home
}

function stopAllMessage(count) {
  return "Stop " + plural(count, "running box") + "?"
}

// ---------------------------------------------------------------- images

// Fully qualified on purpose: podman on nixarchy has no unqualified-search
// registries, so a short name like "alpine" never resolves.
var DEFAULT_IMAGE = "registry.fedoraproject.org/fedora-toolbox:latest"

var IMAGES = [
  { value: "registry.fedoraproject.org/fedora-toolbox:latest", label: "Fedora toolbox" },
  { value: "quay.io/fedora/fedora:latest", label: "Fedora" },
  { value: "quay.io/toolbx/ubuntu-toolbox:24.04", label: "Ubuntu 24.04 toolbox" },
  { value: "quay.io/toolbx/ubuntu-toolbox:22.04", label: "Ubuntu 22.04 toolbox" },
  { value: "docker.io/library/ubuntu:24.04", label: "Ubuntu 24.04" },
  { value: "quay.io/toolbx-images/debian-toolbox:12", label: "Debian 12 toolbox" },
  { value: "docker.io/library/debian:12", label: "Debian 12" },
  { value: "quay.io/toolbx/arch-toolbox:latest", label: "Arch toolbox" },
  { value: "quay.io/toolbx-images/alpine-toolbox:latest", label: "Alpine toolbox" },
  { value: "registry.opensuse.org/opensuse/distrobox:latest", label: "openSUSE Tumbleweed" },
  { value: "quay.io/toolbx-images/rockylinux-toolbox:9", label: "Rocky Linux 9 toolbox" },
  { value: "quay.io/toolbx-images/almalinux-toolbox:9", label: "AlmaLinux 9 toolbox" },
  { value: "quay.io/toolbx-images/centos-toolbox:stream9", label: "CentOS Stream 9 toolbox" }
]

function imagesMatching(query) {
  var q = trim(query).toLowerCase()
  if (!q) return IMAGES.slice()
  var out = []
  for (var i = 0; i < IMAGES.length; i++) {
    if ((IMAGES[i].value + " " + IMAGES[i].label).toLowerCase().indexOf(q) !== -1) out.push(IMAGES[i])
  }
  return out
}

// ---------------------------------------------------------------- validation
//
// distrobox-create builds one command string and runs `eval ${cmd}` on the
// host. Each field lands in a different spot of that string: some unquoted,
// some inside "…", the init hook inside '…'. So each field is checked against
// what is safe in *its* spot, never against a blocklist of "bad" characters.

function isHostname(value) {
  var text = String(value || "")
  if (!text || text.length > 64) return false
  var labels = text.split(".")
  for (var i = 0; i < labels.length; i++) {
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(labels[i])) return false
  }
  return true
}

// registry[:port]/path[:tag][@sha256:digest], lowercase path, the OCI grammar
// without its rarely used corners.
function isImageRef(value) {
  return /^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]{1,5})?(\/[a-z0-9]+(([._]|__|-+)[a-z0-9]+)*)*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(@sha256:[a-f0-9]{64})?$/.test(String(value || ""))
    && String(value).length <= 255
}

// No registry host in front: the engine would have to guess one.
function isShortName(value) {
  var text = String(value || "")
  var slash = text.indexOf("/")
  if (slash === -1) return true
  var host = text.substring(0, slash)
  return host.indexOf(".") === -1 && host.indexOf(":") === -1 && host !== "localhost"
}

function isPlatform(value) {
  return /^[a-z0-9]+\/[a-z0-9_]+(\/[a-z0-9]+)?$/.test(String(value || ""))
}

// ponytail: no spaces or quotes in paths. Paths with spaces are a follow-up;
// they would need a quoting story through distrobox's eval.
function isPath(value) {
  return /^(\/|~\/)[A-Za-z0-9_.\/+-]*$/.test(String(value || "")) && String(value).length <= 4096
}

var VOLUME_OPTION = /^(ro|rw|z|Z|U|O|rslave|rshared|rprivate|slave|shared|private|nocopy|nosuid|nodev|noexec|suid|dev|exec)$/

function isVolumeSpec(value) {
  var parts = String(value || "").split(":")
  if (parts.length < 2 || parts.length > 3) return false
  if (!isPath(parts[0]) || !isPath(parts[1])) return false
  if (parts.length === 3) {
    var opts = parts[2].split(",")
    for (var i = 0; i < opts.length; i++) {
      if (!VOLUME_OPTION.test(opts[i])) return false
    }
  }
  return true
}

function tokens(value) {
  var text = trim(value)
  return text ? text.split(/\s+/) : []
}

function everyToken(value, test) {
  var list = tokens(value)
  for (var i = 0; i < list.length; i++) {
    if (!test(list[i])) return false
  }
  return true
}

function isVolumeList(value) {
  return everyToken(value, isVolumeSpec)
}

function isPackageList(value) {
  return everyToken(value, function(t) { return /^[A-Za-z0-9_.+:@=-]+$/.test(t) })
}

// Flags for the engine, spliced unquoted into the eval'd command. Only
// --flag or --flag=value tokens, with a value charset the shell ignores.
function isFlagList(value) {
  return everyToken(value, function(t) { return /^--?[A-Za-z0-9][A-Za-z0-9-]*(=[A-Za-z0-9_.\/:@,+=-]*)?$/.test(t) })
}

function hasControlChars(value) {
  return /[\x00-\x1f\x7f]/.test(String(value || ""))
}

// Lands inside "…" in the host eval: " \ $ and ` are the only characters that
// act there. The hook itself is shell, run later inside the box.
function isPreInitHook(value) {
  var text = String(value || "")
  return !hasControlChars(text) && !/["\\$`]/.test(text)
}

// Lands inside '…' in the host eval, where only ' can end the quoting.
function isInitHook(value) {
  var text = String(value || "")
  return !hasControlChars(text) && text.indexOf("'") === -1
}

// distrobox puts --home inside "…", where the shell does not expand ~. A
// literal "~/x" would become a directory called "~" wherever distrobox ran.
function expandHome(path, hostHome) {
  var text = String(path || "")
  var host = trim(hostHome).replace(/\/+$/, "")
  return text.indexOf("~/") === 0 && host ? host + text.substring(1) : text
}

function expandVolume(spec, hostHome) {
  var parts = String(spec).split(":")
  parts[0] = expandHome(parts[0], hostHome)
  parts[1] = expandHome(parts[1], hostHome)
  return parts.join(":")
}

// ---------------------------------------------------------------- form

var UNSHARE = [
  { key: "unshareDevsys", flag: "--unshare-devsys", label: "Unshare /dev and /sys" },
  { key: "unshareGroups", flag: "--unshare-groups", label: "Unshare groups" },
  { key: "unshareIpc", flag: "--unshare-ipc", label: "Unshare IPC" },
  { key: "unshareNetns", flag: "--unshare-netns", label: "Unshare the network" },
  { key: "unshareProcess", flag: "--unshare-process", label: "Unshare processes" }
]

function emptyForm() {
  return {
    name: "",
    image: DEFAULT_IMAGE,
    pull: false,
    home: "",
    additionalPackages: "",
    init: false,
    nvidia: false,
    hostname: "",
    clone: "",
    volumes: "",
    additionalFlags: "",
    initHooks: "",
    preInitHooks: "",
    platform: "",
    unshareAll: false,
    unshareDevsys: false,
    unshareGroups: false,
    unshareIpc: false,
    unshareNetns: false,
    unshareProcess: false,
    noEntry: false
  }
}

var PATH_CHARS = "letters, digits and _ . / + -"

// {ok, errors: {field: text}, warnings: {field: text}}. An error blocks the
// create; a warning is shown and allowed.
function validateForm(form, boxes) {
  var f = form || {}
  var errors = {}
  var warnings = {}
  var name = trim(f.name)
  var clone = trim(f.clone)

  if (!name) errors.name = "A name is required"
  else if (!isBoxName(name)) errors.name = "Letters, digits and _ . - only, starting with a letter or digit, at most 63"
  else if (boxByName(boxes, name)) errors.name = "A box called " + name + " already exists"

  if (clone) {
    var source = boxByName(boxes, clone)
    if (!source) errors.clone = "No box called " + clone
    else if (source.up) errors.clone = clone + " is running; stop it first (s) to clone it"
  } else {
    var image = trim(f.image)
    if (!image) errors.image = "An image is required"
    else if (!isImageRef(image)) errors.image = "Not an image reference, e.g. " + DEFAULT_IMAGE
    else if (isShortName(image)) warnings.image = "No registry given; podman here may not resolve short names"
  }

  if (trim(f.hostname) && !isHostname(trim(f.hostname))) errors.hostname = "Letters, digits, - and dots, at most 64"
  if (trim(f.platform) && !isPlatform(trim(f.platform))) errors.platform = "Like linux/amd64 or linux/arm64/v8"
  if (trim(f.home) && !isPath(trim(f.home))) errors.home = "An absolute path or ~/path, using " + PATH_CHARS
  if (!isVolumeList(f.volumes)) errors.volumes = "Space-separated host:box[:ro] pairs, paths using " + PATH_CHARS
  if (!isPackageList(f.additionalPackages)) errors.additionalPackages = "Space-separated package names"
  if (!isFlagList(f.additionalFlags)) errors.additionalFlags = "Space-separated --flag or --flag=value, no spaces inside a value"
  if (!isPreInitHook(f.preInitHooks)) errors.preInitHooks = "Cannot contain \" \\ $ ` or line breaks"
  if (!isInitHook(f.initHooks)) errors.initHooks = "Cannot contain ' or line breaks"

  var ok = true
  for (var k in errors) { ok = false; break }
  return { ok: ok, errors: errors, warnings: warnings }
}

// The full `distrobox create` argv for a form, or null if validateForm says no.
function createArgv(form, engine, boxes, hostHome) {
  if (!validateForm(form, boxes).ok) return null
  var f = form
  var argv = dbx(engine).concat(["distrobox", "create", "--yes", "--name", trim(f.name)])
  if (trim(f.clone)) argv.push("--clone", trim(f.clone))
  else argv.push("--image", trim(f.image))
  if (trim(f.hostname)) argv.push("--hostname", trim(f.hostname))
  if (f.pull === true) argv.push("--pull")
  if (trim(f.home)) argv.push("--home", expandHome(trim(f.home), hostHome))
  var volumes = tokens(f.volumes)
  for (var v = 0; v < volumes.length; v++) argv.push("--volume", expandVolume(volumes[v], hostHome))
  if (trim(f.additionalFlags)) argv.push("--additional-flags", tokens(f.additionalFlags).join(" "))
  if (trim(f.additionalPackages)) argv.push("--additional-packages", tokens(f.additionalPackages).join(" "))
  if (trim(f.initHooks)) argv.push("--init-hooks", trim(f.initHooks))
  if (trim(f.preInitHooks)) argv.push("--pre-init-hooks", trim(f.preInitHooks))
  if (f.init === true) argv.push("--init")
  if (f.nvidia === true) argv.push("--nvidia")
  if (trim(f.platform)) argv.push("--platform", trim(f.platform))
  if (f.unshareAll === true) {
    argv.push("--unshare-all")
  } else {
    for (var u = 0; u < UNSHARE.length; u++) {
      if (f[UNSHARE[u].key] === true) argv.push(UNSHARE[u].flag)
    }
  }
  if (f.noEntry === true) argv.push("--no-entry")
  return argv
}

// One line for the top of the log.
function formSummary(form) {
  var f = form || {}
  return "create " + trim(f.name) + " from " + (trim(f.clone) ? "clone of " + trim(f.clone) : trim(f.image))
}
