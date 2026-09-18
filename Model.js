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
