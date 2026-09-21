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
  { group: "Box", keys: "p", text: "Copy a Nix snippet that declares it in nixarchy" },

  { group: "All boxes", keys: "c", text: "Create a new box" },
  { group: "All boxes", keys: "U", text: "Upgrade every box" },
  { group: "All boxes", keys: "S", text: "Stop every running box" },

  { group: "Panel", keys: "o", text: "Show the create / upgrade log" },
  { group: "Panel", keys: "u", text: "Refresh now" },
  { group: "Panel", keys: "?", text: "Show this list" },

  { group: "Create form", keys: "tab  ↓ / shift+tab  ↑", text: "Next / previous field" },
  { group: "Create form", keys: "space", text: "Flip a switch, open Advanced, cycle the clone source" },
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
// distrobox create exits 0 when the name is already taken, after printing
// "Distrobox named 'x' already exists." A create that says so did not create
// anything, so the panel must not report it as done.
function createRefusal(lines) {
  var list = lines || []
  for (var i = 0; i < list.length; i++) {
    var line = trim(stripAnsi(String(list[i])))
    if (/^Distrobox named '.*' already exists/.test(line)) return line
  }
  return ""
}

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

// 128 + the signal that ended the box's init. `distrobox stop` sends TERM
// (143), and a stop that times out escalates to KILL (137): that is a box
// being stopped, not one that failed.
var STOP_CODES = [129, 130, 137, 143]

function isStopCode(code) {
  return STOP_CODES.indexOf(code) !== -1
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
    failing: state !== "running" && code > 0 && !isStopCode(code),
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
  // Case-insensitive, so "demo-x" sits between "Debian" and "Fedora"; the
  // exact name breaks ties so the order is stable.
  var al = a.name.toLowerCase(), bl = b.name.toLowerCase()
  if (al !== bl) return al < bl ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function sortBoxes(boxes) {
  return (boxes || []).slice().sort(compareBoxes)
}

// What the list shows: stopped boxes hidden when showStopped is off, then the
// filter. Everything else (counts, validation, IPC) reads the full list.
function visibleBoxes(boxes, showStopped, query) {
  var list = boxes || []
  if (showStopped === false) list = list.filter(function(b) { return b.up })
  return filterBoxes(list, query)
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
  if (isStopCode(box.exitCode)) return "Stopped"
  if (box.exitCode > 0) return "Exited (" + box.exitCode + ")"
  if (box.exitCode === 0) return "Stopped"
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

// One j/k step. An inactive cursor (just opened, or back from the filter)
// lands on the row it already points at instead of moving past it, so the
// first j highlights the first row.
function stepCursor(active, index, delta, total) {
  if (total <= 0) return 0
  return clampCursor(active ? index + delta : index, total)
}

// Where the cursor belongs after the rows changed: on the same box if it is
// still listed, otherwise on the same row number, clamped to the new list. The
// list re-sorts (running boxes first) on every refresh, so a bare index would
// silently point at a different box after a start or stop.
function cursorAfter(prevKey, rows, prevIndex) {
  var next = rows || []
  if (prevKey) {
    for (var i = 0; i < next.length; i++) {
      if (next[i].key === prevKey) return i
    }
  }
  return clampCursor(prevIndex, next.length)
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

// The keys on the right of the footer. Only the list needs them: the form,
// the log and the snippet each draw their own, and "esc close" is wrong there.
function footerKeys(mode, mutating) {
  if (mode !== "list") return ""
  return mutating ? "working…" : "? keys   c create   esc close"
}

// The log's own key hint. Scrolling and following only mean something when
// the text is taller than the view.
function logHint(follow, overflows, running) {
  var keys = overflows || running ? (follow ? "following   " : "G follow   ") + "j k scroll   esc back" : "esc back"
  return keys + (running ? " (keeps running)" : "")
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
// something. distrobox prints its progress ("Starting container... [ OK ]")
// on stderr before the failure, so the last "Error" line wins; the first
// meaningful line is only the fallback.
function errorText(raw) {
  var lines = String(raw || "").split("\n")
  var first = ""
  var lastError = ""
  for (var i = 0; i < lines.length; i++) {
    var line = trim(stripAnsi(lines[i]))
    if (!line || /^\+ /.test(line)) continue
    if (!first) first = line
    // distrobox puts it at the end of a progress line
    // ("Firing up init system...  Error: could not …"), so look anywhere in
    // the line. "An error occurred" is its generic sign-off, not the reason.
    var at = line.search(/(^|\s)Error\b/)
    if (at !== -1) {
      var message = trim(line.substring(at))
      if (!/^Error: An error occurred$/i.test(message)) lastError = message
    }
  }
  var chosen = lastError || first
  return chosen ? sanitize(chosen.replace(/^Error(?: response from daemon)?:\s*/i, ""), 160) : ""
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

// Always -a: a stopped box still exists, so it still counts, its name is still
// taken, and IPC can still start it. showStopped only hides it in the view
// (visibleBoxes).
function listArgv(engine) {
  return [engineFor(engine), "ps", "-a"].concat(["--no-trunc", "--filter", "label=manager=distrobox", "--format", BOX_FORMAT])
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

// No DBX_NON_INTERACTIVE: an upgrade of a box that exists asks nothing, and
// for one that vanished, "non-interactive" means answering yes to "create
// it now?". State answers every prompt with "n" instead.
function upgradeArgv(engine, name) {
  if (!isBoxName(name)) return null
  return dbx(engine).concat(["distrobox", "upgrade", name])
}

// U: one upgrade per box, not `distrobox upgrade --all`, which gives up at the
// first box whose container will not start and leaves the rest untouched.
function upgradeAllArgvs(engine, names) {
  var list = names || []
  if (list.length === 0) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var argv = upgradeArgv(engine, list[i])
    if (!argv) return null
    out.push(argv)
  }
  return out
}

// The last line of an upgrade-all, from [{name, code}], and who failed.
function upgradeSummary(results) {
  var list = results || []
  var failed = []
  for (var i = 0; i < list.length; i++) if (list[i].code !== 0) failed.push(list[i].name)
  var text = "── upgraded " + (list.length - failed.length) + " of " + list.length
  if (failed.length > 0) text += " · failed: " + failed.join(", ")
  return { text: text, failed: failed }
}

function copyTextArgv(text) {
  if (typeof text !== "string" || text === "") return null
  return ["wl-copy", "--trim-newline", text]
}

function copyArgv(name) {
  return isBoxName(name) ? copyTextArgv(name) : null
}

// What `nixarchy box promote <name>` prints, byte for byte (nixarchy
// pkgs/box.nix). The user pastes it into their flake; nothing here writes it.
// The name and the image are the only values interpolated, and both regexes
// exclude every character that could close the Nix string or the comment.
var NIX_KEYWORDS = ["assert", "else", "if", "in", "inherit", "let", "or", "rec", "then", "with"]

// A box name as a Nix attribute: bare when it is a plain identifier, quoted
// otherwise ("my.box" would nest, "2box" would not parse). isBoxName already
// keeps quotes, backslashes and $ out, so the quoted form needs no escaping.
function nixAttrName(name) {
  var bare = /^[A-Za-z_][A-Za-z0-9_'-]*$/.test(name) && NIX_KEYWORDS.indexOf(name) === -1
  return bare ? name : "\"" + name + "\""
}

function promoteSnippet(name, image, engine) {
  if (!isBoxName(name) || !isImageRef(image)) return null
  return "programs.nixarchy.services.boxes.machines." + nixAttrName(name) + " = {\n" +
    "  image = \"" + image + "\";\n" +
    "  # Add whatever else this box needs -- additional_packages, init_hooks,\n" +
    "  # exported_apps -- see distrobox-assemble's manual. This snippet only\n" +
    "  # knows what " + engineFor(engine) + " recorded for the image; nothing else about how\n" +
    "  # '" + name + "' was set up by hand is knowable after the fact -- that is the\n" +
    "  # whole point of promoting it: from here on it is declared instead.\n" +
    "};"
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
    noEntry: false,
    // Which template filled the form, if any. Never reaches argv: it only lets
    // the Init switch add or remove that template's init packages.
    template: ""
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

// ---------------------------------------------------------------- form layout
//
// The order the form shows its fields in, and what each one is. `kind` picks
// the widget: text, image (text plus the curated list), bool, clone (cycles
// through stopped boxes), or section (the Advanced switch).

var FORM_FIELDS = [
  { key: "name", kind: "text", label: "Name", hint: "Required. Letters, digits, _ . -" },
  { key: "template", kind: "template", label: "Start from", hint: "↓ picks a distro; fills image, packages and home" },
  { key: "image", kind: "image", label: "Image", hint: "↓ picks from the list, or type a full reference" },
  { key: "pull", kind: "bool", label: "Pull the image even if it is already here" },
  { key: "home", kind: "text", label: "Home directory", hint: "Empty shares your home. e.g. ~/.local/share/distrobox/NAME" },
  { key: "additionalPackages", kind: "text", label: "Extra packages", hint: "Installed on first start, space-separated" },
  { key: "init", kind: "bool", label: "Run an init system (systemd) inside", hint: "The image must ship systemd (toolbox images do not): add systemd to Extra packages" },
  { key: "nvidia", kind: "bool", label: "Share the NVIDIA driver" },
  { key: "advanced", kind: "section", label: "Advanced" },
  { key: "hostname", kind: "text", label: "Hostname", advanced: true },
  { key: "clone", kind: "clone", label: "Clone from", hint: "space cycles through stopped boxes", advanced: true },
  { key: "volumes", kind: "text", label: "Volumes", hint: "host:box[:ro] pairs, space-separated", advanced: true },
  { key: "additionalFlags", kind: "text", label: "Engine flags", hint: "--flag or --flag=value, space-separated", advanced: true },
  { key: "initHooks", kind: "text", label: "Init hooks", hint: "Shell run in the box at each start; no '", advanced: true },
  { key: "preInitHooks", kind: "text", label: "Pre-init hooks", hint: "Shell run before setup; no \" \\ $ `", advanced: true },
  { key: "platform", kind: "text", label: "Platform", hint: "e.g. linux/arm64", advanced: true },
  { key: "unshareAll", kind: "bool", label: "Unshare everything below", advanced: true },
  { key: "unshareDevsys", kind: "bool", label: "Unshare /dev and /sys", advanced: true, underAll: true },
  { key: "unshareGroups", kind: "bool", label: "Unshare groups", advanced: true, underAll: true },
  { key: "unshareIpc", kind: "bool", label: "Unshare IPC", advanced: true, underAll: true },
  { key: "unshareNetns", kind: "bool", label: "Unshare the network", advanced: true, underAll: true },
  { key: "unshareProcess", kind: "bool", label: "Unshare processes", advanced: true, underAll: true },
  { key: "noEntry", kind: "bool", label: "No app-menu entry", advanced: true }
]

function visibleFields(advanced) {
  var out = []
  for (var i = 0; i < FORM_FIELDS.length; i++) {
    if (!FORM_FIELDS[i].advanced || advanced) out.push(FORM_FIELDS[i])
  }
  return out
}

// Where the cursor lands to show the first error: in field order.
function firstErrorIndex(fields, errors) {
  for (var i = 0; i < (fields || []).length; i++) {
    if (errors && errors[fields[i].key]) return i
  }
  return -1
}

function stoppedBoxNames(boxes) {
  var out = []
  for (var i = 0; i < (boxes || []).length; i++) {
    if (!boxes[i].up) out.push(boxes[i].name)
  }
  return out.sort()
}

// "" (no clone) → first stopped box → … → last → "" again.
function nextClone(current, names) {
  var list = [""].concat(names || [])
  var at = list.indexOf(current || "")
  return list[(at + 1) % list.length]
}

// ---------------------------------------------------------------- templates
//
// A template fills the fields that differ from one distro to the next. The
// init packages are distrobox's own documented list (1.8.2.5,
// docs/useful_tips.md, "Using init system inside a distrobox"): the toolbox
// images ship no systemd, so --init alone fails with "no init found".
// `tested` is true only once a box from the template has been created,
// started with Init on, and entered on nixarchy.

var TEMPLATES = [
  { id: "fedora", label: "Fedora", image: "registry.fedoraproject.org/fedora-toolbox:latest",
    packages: "", initPackages: "systemd", tested: true },
  { id: "ubuntu", label: "Ubuntu 24.04", image: "quay.io/toolbx/ubuntu-toolbox:24.04",
    packages: "", initPackages: "systemd libpam-systemd pipewire-audio-client-libraries", tested: true },
  { id: "debian", label: "Debian 12", image: "quay.io/toolbx-images/debian-toolbox:12",
    packages: "", initPackages: "systemd libpam-systemd pipewire-audio-client-libraries", tested: true },
  { id: "arch", label: "Arch", image: "quay.io/toolbx/arch-toolbox:latest",
    packages: "", initPackages: "systemd", tested: true }
]

var BLANK_TEMPLATE = { id: "", label: "Blank", image: "", packages: "", initPackages: "", tested: false }

function templateById(id) {
  for (var i = 0; i < TEMPLATES.length; i++) {
    if (TEMPLATES[i].id === id) return TEMPLATES[i]
  }
  return null
}

// Blank, the built-ins, then the user's own (fileEntries, from fileTemplates),
// filtered by what has been typed.
function templateChoices(query, fileEntries) {
  var q = trim(query).toLowerCase()
  var all = [BLANK_TEMPLATE].concat(TEMPLATES, fileEntries || [])
  if (!q) return all
  var out = []
  for (var i = 0; i < all.length; i++) {
    if ((all[i].label + " " + all[i].image).toLowerCase().indexOf(q) !== -1) out.push(all[i])
  }
  return out
}

// Space-separated tokens, each once, in first-seen order.
function joinPackages(a, b) {
  var out = []
  var parts = tokens(a).concat(tokens(b))
  for (var i = 0; i < parts.length; i++) {
    if (out.indexOf(parts[i]) === -1) out.push(parts[i])
  }
  return out.join(" ")
}

// The form with a template applied: image, packages and home follow the
// template; the name is the user's and is never touched. Blank puts those
// three back to the defaults.
function applyTemplate(form, id) {
  var next = Object.assign({}, form || emptyForm())
  var defaults = emptyForm()
  var t = templateById(id)
  next.clone = ""
  if (!t) {
    next.template = ""
    next.image = defaults.image
    next.additionalPackages = defaults.additionalPackages
    next.home = defaults.home
    return next
  }
  next.template = t.id
  next.image = t.image
  next.additionalPackages = joinPackages(t.packages, next.init === true ? t.initPackages : "")
  next.home = isBoxName(trim(next.name)) ? "~/.local/share/distrobox/" + trim(next.name) : ""
  return next
}

// Init on adds the current template's init packages; Init off removes exactly
// those tokens, and only those, so a package the user typed stays unless it
// is one of the template's own init packages.
function setInit(form, on) {
  var next = Object.assign({}, form || emptyForm())
  next.init = on === true
  var t = templateById(next.template)
  if (!t || !t.initPackages) return next
  if (next.init) {
    next.additionalPackages = joinPackages(next.additionalPackages, t.initPackages)
  } else {
    var drop = tokens(t.initPackages)
    var keep = []
    var have = tokens(next.additionalPackages)
    for (var i = 0; i < have.length; i++) {
      if (drop.indexOf(have[i]) === -1) keep.push(have[i])
    }
    next.additionalPackages = keep.join(" ")
  }
  return next
}

// ---------------------------------------------------------------- assemble files
//
// The user's own templates, from a `distrobox assemble` .ini file. Read here,
// in JavaScript, and never handed to distrobox: distrobox-assemble (1.8.2.5)
// writes each key=value into a file it then sources as shell, so an unquoted
// `$(...)` value runs on the host just from being read. The line rules below
// mirror its parse_file and resolve_includes; where those would produce
// something broken or ambiguous, this refuses with a reason instead of
// guessing. Every value then goes through validateForm like typed input.

var ASSEMBLE_MAX_BYTES = 65536
var ASSEMBLE_MAX_LINES = 256
var ASSEMBLE_MAX_DEPTH = 8

var ASSEMBLE_BOOLS = ["init", "pull", "nvidia", "entry", "root", "start_now", "replace",
  "unshare_all", "unshare_devsys", "unshare_groups", "unshare_ipc", "unshare_netns", "unshare_process"]
var ASSEMBLE_SINGLE = ["image", "clone", "home", "hostname"]
var ASSEMBLE_CUMULATIVE = ["volume", "additional_packages", "additional_flags", "init_hooks", "pre_init_hooks"]
var ASSEMBLE_REFUSED = {
  exported_apps: "exported_apps runs commands inside the box; not supported yet",
  exported_bins: "exported_bins runs commands inside the box; not supported yet",
  exported_bins_path: "exported_bins_path belongs to exported_bins; not supported yet"
}

function stripOneQuotePair(value) {
  var v = String(value)
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.substring(1, v.length - 1)
  }
  return v
}

// {sections: [{name, lines: [{key, value}], errors: []}], errors: []}
function parseAssemble(text) {
  var raw = String(text === undefined || text === null ? "" : text)
  var out = { sections: [], errors: [] }
  if (raw.length > ASSEMBLE_MAX_BYTES) {
    out.errors.push("the file is larger than 64 KB")
    return out
  }
  var current = null
  var lines = raw.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\t/g, " ")
    if (line.charAt(0) === "#") line = ""
    line = line.replace(/\].*#.*/, "")
    line = line.replace(/ #.*/, "")
    line = line.replace(/\s*$/, "")
    if (!line) continue
    if (line.charAt(0) === "[") {
      current = { name: line.replace(/[\][ ]/g, ""), lines: [], errors: [] }
      out.sections.push(current)
      continue
    }
    if (!current) {
      out.errors.push("line " + (i + 1) + " is outside any [section] and is ignored")
      continue
    }
    var eq = line.indexOf("=")
    if (eq === -1) {
      current.errors.push("line " + (i + 1) + " has no key=value")
      continue
    }
    var key = line.substring(0, eq).replace(/ /g, "")
    var value = line.substring(eq + 1)
    if (value === "true") value = "1"
    else if (value === "false") value = "0"
    if (!key || value === "") continue
    current.lines.push({ key: key, value: stripOneQuotePair(value) })
  }
  return out
}

function assembleSection(parsed, name) {
  for (var i = 0; i < parsed.sections.length; i++) {
    if (parsed.sections[i].name === name) return parsed.sections[i]
  }
  return null
}

// A section's lines with every include=X inlined in place. A section already
// on the include chain is a circular reference, as in resolve_includes.
// {lines, error}
function resolveSection(parsed, name) {
  var count = 0
  function expand(section, chain, depth) {
    if (depth > ASSEMBLE_MAX_DEPTH) return { error: "includes nested deeper than " + ASSEMBLE_MAX_DEPTH }
    var result = []
    for (var i = 0; i < section.lines.length; i++) {
      var l = section.lines[i]
      if (l.key !== "include") {
        count += 1
        if (count > ASSEMBLE_MAX_LINES) return { error: "more than " + ASSEMBLE_MAX_LINES + " lines" }
        result.push(l)
        continue
      }
      var target = String(l.value).replace(/"/g, "")
      if (chain.indexOf(target) !== -1) return { error: "circular include of [" + target + "]" }
      var inc = assembleSection(parsed, target)
      if (!inc) return { error: "include [" + target + "] not found" }
      var sub = expand(inc, chain.concat([target]), depth + 1)
      if (sub.error) return sub
      result = result.concat(sub.lines)
    }
    return { lines: result }
  }
  var start = assembleSection(parsed, name)
  if (!start) return { error: "no section [" + name + "]" }
  return expand(start, [name], 0)
}

function joinHooks(parts) {
  var out = ""
  for (var i = 0; i < parts.length; i++) {
    var p = String(parts[i])
    if (!out) { out = p; continue }
    out += /(;|&&)\s?$/.test(out) ? " " + p : "; " + p
  }
  return out
}

// A section's resolved lines as a form, with what could not be taken over.
// {form, refused: [reason], notes: [text]}
function sectionToForm(name, lines) {
  var form = emptyForm()
  form.name = name
  form.template = "file:" + name
  var refused = []
  var notes = []
  var seen = {}
  var cumulative = {}
  for (var i = 0; i < lines.length; i++) {
    var key = lines[i].key
    var value = lines[i].value
    if (ASSEMBLE_REFUSED[key]) { refused.push(ASSEMBLE_REFUSED[key]); continue }
    if (key === "name") { notes.push("name= is ignored; the section name is the box name"); continue }
    if (ASSEMBLE_CUMULATIVE.indexOf(key) !== -1) {
      if (!cumulative[key]) cumulative[key] = []
      cumulative[key].push(value)
      continue
    }
    if (ASSEMBLE_BOOLS.indexOf(key) !== -1) {
      if (value !== "1" && value !== "0") { refused.push(key + " must be true or false, not \"" + value + "\""); continue }
      var on = value === "1"
      if (key === "root" && on) { refused.push("root=true boxes are not supported by the plugin"); continue }
      if (key === "replace" && on) { refused.push("replace=true deletes an existing box; not supported"); continue }
      if (key === "start_now") { if (on) notes.push("start_now is ignored; start the box with s"); continue }
      if (key === "root" || key === "replace") continue
      if (key === "entry") form.noEntry = !on
      else if (key === "unshare_all") form.unshareAll = on
      else if (key.indexOf("unshare_") === 0) form["unshare" + key.charAt(8).toUpperCase() + key.substring(9)] = on
      else form[key] = on
      continue
    }
    if (ASSEMBLE_SINGLE.indexOf(key) !== -1) {
      if (seen[key]) { refused.push(key + " is set more than once"); continue }
      seen[key] = true
      form[key] = value
      continue
    }
    refused.push("unknown key \"" + key + "\"")
  }
  if (cumulative.volume) form.volumes = cumulative.volume.join(" ")
  if (cumulative.additional_packages) form.additionalPackages = cumulative.additional_packages.join(" ")
  if (cumulative.additional_flags) form.additionalFlags = cumulative.additional_flags.join(" ")
  if (cumulative.init_hooks) form.initHooks = joinHooks(cumulative.init_hooks)
  if (cumulative.pre_init_hooks) form.preInitHooks = joinHooks(cumulative.pre_init_hooks)
  if (seen.clone) form.image = ""
  return { form: form, refused: refused, notes: notes }
}

// The "Yours" entries: one per section, usable only if it resolves, nothing
// is refused, and validateForm accepts it (a taken name is judged at create
// time, against the real list of boxes).
function fileTemplates(text) {
  var parsed = parseAssemble(text)
  var out = []
  for (var i = 0; i < parsed.sections.length; i++) {
    var s = parsed.sections[i]
    var reasons = s.errors.slice()
    var mapped = { form: emptyForm(), refused: [], notes: [] }
    if (!isBoxName(s.name)) reasons.push("[" + s.name + "] is not a valid box name")
    var resolved = resolveSection(parsed, s.name)
    if (resolved.error) reasons.push(resolved.error)
    else {
      mapped = sectionToForm(s.name, resolved.lines)
      reasons = reasons.concat(mapped.refused)
      var check = validateForm(mapped.form, [])
      for (var k in check.errors) reasons.push(k + ": " + check.errors[k])
    }
    out.push({
      id: "file:" + s.name, label: s.name, image: mapped.form.image || (mapped.form.clone ? "clone of " + mapped.form.clone : ""),
      tested: false, source: "file", form: mapped.form, usable: reasons.length === 0,
      reasons: reasons, notes: mapped.notes
    })
  }
  return { templates: out, errors: parsed.errors }
}

var DEFAULT_TEMPLATES_FILE = "~/.config/distrobox/boxes.ini"

// The template file's absolute path. Anything that is not a plain path falls
// back to the default, so a setting can never name something odd to read.
function templatesPath(value, hostHome) {
  var v = trim(value)
  return expandHome(isPath(v) ? v : DEFAULT_TEMPLATES_FILE, hostHome)
}

// A usable file template applied to the form: its values, with a name the user
// already typed kept.
function applyFileTemplate(form, entry) {
  if (!entry || !entry.usable) return form
  var next = Object.assign({}, entry.form)
  var typed = trim(form && form.name)
  if (typed) next.name = typed
  return next
}
