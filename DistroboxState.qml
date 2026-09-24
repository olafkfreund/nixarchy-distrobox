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
  readonly property string templatesPath: Model.templatesPath(settings.templatesFile, hostHome)

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
  // How many list queries have run: the `status` hook reports it, so "does it
  // poll while closed" can be measured from outside rather than assumed.
  property int polls: 0

  // ------------------------------------------------------------ the lock

  property string pendingName: ""
  property string pendingVerb: ""
  // Follow-up commands of a multi-step action (restart = stop, then start).
  property var queue: []
  readonly property bool mutating: actionProcess.running || streaming || queue.length > 0

  // Set by cancel(), consumed by the very next exit handler. SIGTERM gives a
  // non-zero code, so without this a deliberate cancel would report itself as
  // "failed (exit 15)". It cannot wedge anything: the lock stays derived, and
  // whichever exit runs next clears this whether it set it or not.
  property bool cancelling: false

  // --------------------------------------------------------------- stream

  property var log: []
  property string streamTitle: ""
  property string streamName: ""
  property int streamExit: -1
  // Upgrade-all: the boxes still to go ({name, argv}) and how each one ended.
  // The queue counts as streaming, so the lock holds between two boxes.
  property var streamQueue: []
  property var streamResults: []
  property bool streamAll: false
  readonly property bool streaming: streamProcess.running || streamQueue.length > 0

  // -------------------------------------------------------------- refresh

  function refresh() {
    if (listProcess.running) return
    root.loading = true
    root.polls += 1
    listProcess.command = Model.listArgv(root.engine)
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

  // Opening a surface also re-reads the templates file: FileView cannot watch
  // a file (or a directory) that did not exist yet, so a boxes.ini made after
  // the shell started would otherwise never load.
  onActiveChanged: if (active) { refresh(); templatesFile.reload() }

  // The list came from the old engine: forget it and its homes.
  onEngineChanged: {
    root.rawBoxes = []
    root.homes = ({})
    root.homesKey = ""
    if (root.active || root.background) root.refresh()
  }

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

  // A "Busy: …" refusal is about the operation that held the lock; once that
  // ends, the notice is wrong, so every exit handler drops it.
  function clearBusyNotice() {
    if (root.lastError.indexOf("Busy: ") === 0) root.lastError = ""
  }

  function busyText() {
    return Model.busyText(root.streaming, root.streamTitle, root.pendingVerb, root.pendingName)
  }

  // The way out of a command that never exits. Process has no kill(): setting
  // `running` false sends SIGTERM, `exited` fires, and the lock releases
  // through the derived property, so nothing new has to be unset afterwards.
  //
  // The queues are cleared FIRST. onExited starts the next command while one
  // is waiting, so cancelling with a queue still loaded would hand the lock
  // straight to the next box instead of giving it back.
  function cancel() {
    var target = Model.cancelTarget(root.mutating, root.streaming, root.streamTitle,
                                    root.pendingVerb, root.pendingName)
    if (!target) return false
    root.cancelling = true
    root.queue = []
    root.streamQueue = []
    root.streamAll = false
    if (target.process === "stream") {
      root.appendLog("── cancelled")
      streamProcess.running = false
    } else {
      actionProcess.running = false
    }
    root.lastError = target.label + " cancelled"
    return true
  }

  // Only boxes the selected engine listed. `distrobox enter` on a name it
  // cannot find asks "Create it now? [Y/n]", and every non-answer (EOF,
  // DBX_NON_INTERACTIVE) means yes: a start would create a box. So a name
  // that is not in the list never reaches a command, whoever asked for it
  // (a key, a row button, or IPC).
  function known(name) {
    if (Model.boxByName(root.boxes, name)) return true
    root.lastError = "No box called " + name + " in " + root.engine
    return false
  }

  // Starts a command and answers any question it asks with "n", then closes
  // stdin. A command that asks nothing ignores it; the one question distrobox
  // can still ask here (a box deleted between the list and the command) gets
  // a no, instead of a hang with the lock held.
  function launch(proc, argv) {
    proc.stdinEnabled = true
    proc.command = argv
    proc.running = true
    proc.write("n\n")
    proc.stdinEnabled = false
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
    root.launch(actionProcess, argvs[0])
    return true
  }

  function start(name) { return known(name) && run([Model.startArgv(root.engine, name)], "starting", name) }
  function stop(name) { return known(name) && run([Model.stopArgv(root.engine, [name])], "stopping", name) }
  function remove(name) { return known(name) && run([Model.removeArgv(root.engine, name)], "deleting", name) }

  function restart(name) {
    if (!known(name)) return false
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
    root.launch(streamProcess, argv)
    return true
  }

  function upgrade(name) {
    if (name) return known(name) && startStream(Model.upgradeArgv(root.engine, name), "upgrade " + name, name)
    var names = Model.boxNames(root.boxes)
    var argvs = Model.upgradeAllArgvs(root.engine, names)
    if (!argvs || !startStream(argvs[0], "upgrade all boxes", names[0])) return false
    root.streamAll = true
    root.streamResults = []
    var rest = []
    for (var i = 1; i < names.length; i++) rest.push({ name: names[i], argv: argvs[i] })
    root.streamQueue = rest
    root.appendLog("── " + names[0])
    return true
  }

  function create(form) {
    var argv = Model.createArgv(form, root.engine, root.boxes, root.hostHome)
    return startStream(argv, Model.formSummary(form), form ? String(form.name) : "")
  }

  // One box of an upgrade-all ended: log it, then start the next on the next
  // tick (taken off the queue in the same step, so the lock never drops), or
  // finish with the summary. A box that fails does not stop the rest.
  function upgradeAllStep(code) {
    var results = root.streamResults.slice()
    results.push({ name: root.streamName, code: code })
    root.streamResults = results
    root.appendLog("── " + root.streamName + ": exit " + code)
    if (root.streamQueue.length > 0) {
      Qt.callLater(function() {
        var next = root.streamQueue[0]
        root.streamName = next.name
        root.appendLog("── " + next.name)
        root.launch(streamProcess, next.argv)
        root.streamQueue = root.streamQueue.slice(1)
      })
      return
    }
    var summary = Model.upgradeSummary(results)
    root.streamAll = false
    root.clearBusyNotice()
    root.streamExit = summary.failed.length > 0 ? 1 : 0
    root.appendLog(summary.text)
    if (summary.failed.length > 0)
      root.lastError = "upgrade failed for " + summary.failed.join(", ") + " — o shows the log"
    if (root.active || root.background) root.refresh()
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
    if (!known(name)) return false
    var argv = Model.enterArgv(root.engine, name)
    if (!argv) return false
    Quickshell.execDetached(argv)
    return true
  }

  function runCopy(argv) {
    if (!argv || copyProcess.running) return
    copyProcess.command = argv
    copyProcess.running = true
  }

  function copyName(name) {
    runCopy(Model.copyArgv(name))
  }

  function copyText(text) {
    runCopy(Model.copyTextArgv(text))
  }

  function statusJson() {
    return JSON.stringify({
      instance: root.instanceId,
      engine: root.engine,
      bars: root.bars,
      views: root.views,
      polls: root.polls,
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
      var cancelled = root.cancelling
      root.cancelling = false
      if (root.queue.length === 0 || code !== 0) root.clearBusyNotice()
      if (code !== 0 && !cancelled) {
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
          root.launch(actionProcess, next)
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
      var wasCancelled = root.cancelling
      root.cancelling = false
      if (root.streamAll && !wasCancelled) { root.upgradeAllStep(code); return }
      root.clearBusyNotice()
      if (wasCancelled) {
        root.streamExit = code
        if (root.active || root.background) root.refresh()
        return
      }
      var creating = root.streamTitle.indexOf("create ") === 0
      var refusal = creating && code === 0 ? Model.createRefusal(root.log) : ""
      var failed = code !== 0 || refusal !== ""
      root.streamExit = failed && code === 0 ? 1 : code
      root.appendLog("── exit " + code + " · " + (failed ? "failed" : "done"))
      if (refusal) root.lastError = refusal
      else if (code !== 0) root.lastError = root.streamTitle + " failed (exit " + code + ") — o shows the log"
      else if (creating)
        root.appendLog("The box is created. Its first start (s, or enter) finishes setting it up.")
      if (root.active || root.background) root.refresh()
    }
  }

  Process { id: copyProcess }

  // The user's own templates (#8). Read and parsed here, never handed to
  // distrobox; a missing file is simply no templates.
  property var userTemplates: []
  property var templateFileErrors: []

  FileView {
    id: templatesFile
    path: root.templatesPath
    watchChanges: true
    blockLoading: false
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      var parsed = Model.fileTemplates(text())
      root.userTemplates = parsed.templates
      root.templateFileErrors = parsed.errors
    }
    onLoadFailed: function(err) {
      root.userTemplates = []
      root.templateFileErrors = []
    }
  }
}
