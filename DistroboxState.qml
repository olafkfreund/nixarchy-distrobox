pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Everything the plugin knows about distrobox, and every way it talks to it.
// Nothing here draws.
//
// One instance for the bar and the menu (qmldir makes this a singleton), so
// that "one mutation at a time" holds across both surfaces and a log started
// in one is there to watch in the other.
Singleton {
  id: root

  // {refreshIntervalSec, showStopped, containerManager}. Whichever surface
  // opened last writes it; both read the same bar entry, so they agree.
  property var settings: ({})

  readonly property int refreshIntervalSec: Math.max(5, Number(settings.refreshIntervalSec || 30))
  readonly property bool showStopped: settings.showStopped !== false
  readonly property string engine: Model.engineFor(settings.containerManager)
  readonly property string hostHome: Quickshell.env("HOME") || ""

  // A token to prove from outside that every surface holds this one instance.
  readonly property string instanceId: Math.random().toString(36).substring(2, 10)

  // ------------------------------------------------------------ interest
  //
  // Surfaces say when they need data. A bar keeps the slow poll alive for its
  // glyph; an open view polls fast. Nothing polls when neither holds on.

  property int bars: 0
  property int views: 0
  readonly property bool background: bars > 0
  readonly property bool active: views > 0

  function acquire(kind) {
    if (kind === "bar") bars += 1
    else views += 1
  }

  function release(kind) {
    if (kind === "bar") bars = Math.max(0, bars - 1)
    else views = Math.max(0, views - 1)
  }

  // ---------------------------------------------------------------- data

  property var rawBoxes: []
  property var homes: ({})
  property string homesKey: ""
  readonly property var boxes: Model.normalizeBoxes(rawBoxes, homes, hostHome)
  readonly property var counts: Model.counts(boxes)

  property bool reachable: true
  property bool loading: false
  property bool everLoaded: false
  property string lastError: ""

  // ------------------------------------------------------------ the lock

  property string pendingName: ""
  property string pendingVerb: ""
  // Follow-up commands of a multi-step action (restart = stop, then start).
  property var queue: []
  readonly property bool mutating: actionProcess.running || streamProcess.running || queue.length > 0

  // --------------------------------------------------------------- stream

  property var log: []
  property string streamTitle: ""
  property string streamName: ""
  property int streamExit: -1
  readonly property bool streaming: streamProcess.running

  // -------------------------------------------------------------- refresh

  function refresh() {
    if (listProcess.running) return
    root.loading = true
    listProcess.command = Model.listArgv(root.engine, root.showStopped)
    listProcess.running = true
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: root.background || root.active
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 3000
    running: root.active
    repeat: true
    onTriggered: root.refresh()
  }

  onActiveChanged: if (active) refresh()

  // The list came from the old engine: forget it and its homes.
  onEngineChanged: {
    root.rawBoxes = []
    root.homes = ({})
    root.homesKey = ""
    if (root.active || root.background) root.refresh()
  }

  onShowStoppedChanged: if (root.active || root.background) root.refresh()

  // Homes are one inspect per change of the set of boxes, never per poll.
  function refreshHomes(names) {
    var key = names.slice().sort().join("\n")
    if (key === root.homesKey || homesProcess.running) return
    root.homesKey = key
    var argv = Model.inspectHomesArgv(root.engine, names)
    if (!argv) { root.homes = ({}); return }
    homesProcess.command = argv
    homesProcess.running = true
  }

  // -------------------------------------------------------------- actions

  function busyText() {
    if (streamProcess.running) return "Busy: " + root.streamTitle + " — press o to watch"
    return "Busy: " + root.pendingVerb + (root.pendingName ? " " + root.pendingName : "") + " — wait for it to finish"
  }

  // Every mutation comes through here. Refuses, with a reason, while anything
  // else mutates; the argv is null when a name failed validation.
  function run(argvs, verb, name) {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argvs || argvs.length === 0 || !argvs[0]) return false
    for (var i = 0; i < argvs.length; i++) if (!argvs[i]) return false
    root.lastError = ""
    root.pendingVerb = verb
    root.pendingName = name || ""
    root.queue = argvs.slice(1)
    actionProcess.command = argvs[0]
    actionProcess.running = true
    return true
  }

  function start(name) { return run([Model.startArgv(root.engine, name)], "starting", name) }
  function stop(name) { return run([Model.stopArgv(root.engine, [name])], "stopping", name) }
  function remove(name) { return run([Model.removeArgv(root.engine, name)], "deleting", name) }

  function restart(name) {
    var argvs = Model.restartArgvs(root.engine, name)
    return argvs ? run(argvs, "restarting", name) : false
  }

  function stopAll() {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    var names = []
    for (var i = 0; i < root.boxes.length; i++) if (root.boxes[i].up) names.push(root.boxes[i].name)
    if (names.length === 0) return false
    return run([Model.stopArgv(root.engine, names)], "stopping", "all")
  }

  function startStream(argv, title, name) {
    if (root.mutating) { root.lastError = root.busyText(); return false }
    if (!argv) return false
    root.lastError = ""
    root.streamTitle = title
    root.streamName = name || ""
    root.streamExit = -1
    root.log = ["$ " + title]
    streamProcess.command = argv
    streamProcess.running = true
    return true
  }

  function upgrade(name) {
    return startStream(Model.upgradeArgv(root.engine, name), name ? "upgrade " + name : "upgrade all boxes", name)
  }

  function create(form) {
    var argv = Model.createArgv(form, root.engine, root.boxes, root.hostHome)
    return startStream(argv, Model.formSummary(form), form ? String(form.name) : "")
  }

  function appendLog(line) {
    var next = root.log.slice()
    next.push(Model.capLine(Model.stripAnsi(line)))
    if (next.length > 400) next.splice(0, next.length - 400)
    root.log = next
  }

  // ----------------------------------------------------------- side effects

  // Not a mutation: entering never changes the box, and distrobox enter waits
  // for any first-run setup by itself.
  function enter(name) {
    var argv = Model.enterArgv(root.engine, name)
    if (!argv) return false
    Quickshell.execDetached(argv)
    return true
  }

  function copyName(name) {
    var argv = Model.copyArgv(name)
    if (!argv || copyProcess.running) return
    copyProcess.command = argv
    copyProcess.running = true
  }

  function statusJson() {
    return JSON.stringify({
      instance: root.instanceId,
      engine: root.engine,
      bars: root.bars,
      views: root.views,
      mutating: root.mutating,
      pending: root.pendingVerb + (root.pendingName ? " " + root.pendingName : ""),
      streaming: root.streaming,
      stream: root.streamTitle,
      boxes: Model.boxNames(root.boxes),
      lastError: root.lastError
    })
  }

  // ------------------------------------------------------------ processes

  Process {
    id: listProcess
    stdout: StdioCollector { id: listOut; waitForEnd: true }
    stderr: StdioCollector { id: listErr; waitForEnd: true }

    onExited: function(code) {
      root.loading = false
      root.everLoaded = true
      if (code !== 0) {
        root.reachable = false
        root.rawBoxes = []
        return
      }
      root.reachable = true
      root.rawBoxes = Model.parseJsonLines(listOut.text)
      var names = []
      for (var i = 0; i < root.rawBoxes.length; i++) {
        var name = Model.normalizeName(root.rawBoxes[i].Names)
        if (Model.isBoxName(name)) names.push(name)
      }
      root.refreshHomes(names)
    }
  }

  Process {
    id: homesProcess
    stdout: StdioCollector { id: homesOut; waitForEnd: true }
    onExited: function(code) {
      // A box removed between list and inspect makes inspect fail, but it
      // still prints the others; take what came back.
      root.homes = Model.parseHomes(homesOut.text)
    }
  }

  Process {
    id: actionProcess
    stderr: StdioCollector { id: actionErr; waitForEnd: true }

    onExited: function(code) {
      if (code !== 0) {
        root.lastError = Model.errorText(actionErr.text) || (root.pendingVerb + " failed (exit " + code + ")")
        root.queue = []
      }
      if (root.queue.length > 0) {
        // Started on the next tick, not from inside this process's own exit.
        // The queue is only consumed in the same synchronous step that starts
        // the next command, so `mutating` never drops between the two.
        Qt.callLater(function() {
          var next = root.queue[0]
          root.queue = root.queue.slice(1)
          actionProcess.command = next
          actionProcess.running = true
        })
        return
      }
      root.pendingVerb = ""
      root.pendingName = ""
      if (root.active || root.background) root.refresh()
    }
  }

  Process {
    id: streamProcess
    stdout: SplitParser { onRead: function(line) { root.appendLog(line) } }
    stderr: SplitParser { onRead: function(line) { root.appendLog(line) } }

    onExited: function(code) {
      root.streamExit = code
      root.appendLog("── exit " + code + " · " + (code === 0 ? "done" : "failed"))
      if (code !== 0) root.lastError = root.streamTitle + " failed (exit " + code + ") — o shows the log"
      else if (root.streamTitle.indexOf("create ") === 0)
        root.appendLog("The box is created. Its first start (s, or enter) finishes setting it up.")
      if (root.active || root.background) root.refresh()
    }
  }

  Process { id: copyProcess }
}
