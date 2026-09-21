import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Ui
import qs.Commons
import "Model.js" as Model

// Everything you can press: the list, the filter, the questions, and the
// create form and log once they are open. It draws the DistroboxState
// singleton, so the bar popup and the full-screen menu share every key.
FocusScope {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.5)

  // KeyboardPanel focuses this directly: handing it the FocusScope instead
  // would restore whichever child held focus last, stale filter field included.
  readonly property alias keyTarget: keyCatcher

  implicitHeight: column.implicitHeight

  signal closeRequested()
  signal switchPanelRequested(int direction)

  // ------------------------------------------------------------------ state

  // list | form | log | snippet. Everything but the list owns the keyboard
  // while open.
  property string mode: "list"

  // The promote snippet on screen, kept here rather than in the singleton:
  // it is one row's text, not shared state, and it must never disturb the
  // stream a create or upgrade is writing.
  property var snippetLines: []
  property string snippetName: ""

  property string filterText: ""

  property var confirmAction: null
  property string confirmMessage: ""
  property string confirmLabel: "Delete"
  property bool confirmOpen: false
  property bool helpOpen: false

  property int cursorIndex: 0
  // The box the cursor is on, remembered separately from the row number: the
  // list re-sorts on every refresh (running boxes first), so the row a box sits
  // in changes under the cursor. Not a binding: a binding would re-read the
  // re-sorted list and follow the wrong box.
  property string cursorKey: ""
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  // ------------------------------------------------------------- derivation

  readonly property var visibleBoxes: Model.visibleBoxes(DistroboxState.boxes, DistroboxState.showStopped, filterText)
  readonly property var rows: Model.rowsFor(visibleBoxes)
  readonly property var cursorRow: cursorIndex >= 0 && cursorIndex < rows.length ? rows[cursorIndex] : null
  readonly property var cursorBox: cursorRow ? Model.boxByName(DistroboxState.boxes, cursorRow.name) : null
  readonly property var lock: ({ mutating: DistroboxState.mutating })

  onRowsChanged: root.rememberCursor(Model.cursorAfter(root.cursorActive ? root.cursorKey : "", root.rows, root.cursorIndex))

  // Every change of the cursor comes through here, so the row number and the
  // remembered box never disagree.
  function rememberCursor(index) {
    root.cursorIndex = Model.clampCursor(index, root.rows.length)
    root.cursorKey = root.cursorActive && root.rows.length > 0 ? root.rows[root.cursorIndex].key : ""
  }

  // ------------------------------------------------------------ lifecycle

  // Called every time the surface opens: fresh cursor, empty filter, back to
  // the list. Never touches the stream or its log: a create in flight survives
  // any number of closes.
  function reset() {
    mode = "list"
    cursorActive = false
    cursorKey = ""
    filterText = ""
    filterField.text = ""
    rememberCursor(0)
    filterField.focus = false
    DistroboxState.lastError = ""
    helpOpen = false
    closeConfirm()
    Qt.callLater(root.focusForMode)
  }

  // Deferred, and decided by the mode at the time it runs, so an open that
  // lands straight in the form (IPC create) keeps the form's focus.
  function focusForMode() {
    if (root.mode === "log") logView.forceActiveFocus()
    else if (root.mode === "snippet") snippetView.forceActiveFocus()
    else if (root.mode === "form") createForm.focusCurrent()
    else keyCatcher.forceActiveFocus()
  }

  function setMode(next) {
    root.mode = next
    root.helpOpen = false
    Qt.callLater(root.focusForMode)
  }

  // c, IPC create, or the menu's {"create":true}.
  function openForm() {
    root.mode = "form"
    root.helpOpen = false
    createForm.start()
  }

  function submitForm(form) {
    if (DistroboxState.create(form)) setMode("log")
    // Refused (another job holds the lock): the reason is in the error line
    // on the list, so go and show it.
    else setMode("list")
  }

  // o: back to whatever the last create or upgrade printed.
  function openLog() {
    if (DistroboxState.log.length === 0) return
    setMode("log")
  }

  function upgrade(name) {
    if (DistroboxState.upgrade(name)) setMode("log")
  }

  // p: the snippet that declares this box in a nixarchy flake, on the
  // clipboard and on screen. Read-only, so it ignores the mutation lock and
  // leaves the stream alone.
  function promote(box) {
    var snippet = Model.promoteSnippet(box.name, box.image, DistroboxState.engine)
    if (!snippet) return
    DistroboxState.copyText(snippet)
    root.snippetName = box.name
    root.snippetLines = snippet.split("\n")
    setMode("snippet")
  }

  // Called when the surface closes.
  function dismiss() {
    helpOpen = false
    closeConfirm()
  }

  // --------------------------------------------------------------- actions

  // Every row button and key ends up here, so this is the one place a verb
  // turns into something that happens.
  function dispatch(name, verb) {
    var box = Model.boxByName(DistroboxState.boxes, name)
    if (!box) return
    if (verb === "enter") {
      if (DistroboxState.enter(name)) root.closeRequested()
      return
    }
    if (verb === "remove") { askRemove(box); return }
    if (verb === "copy") { DistroboxState.copyName(name); return }
    if (verb === "promote") { promote(box); return }
    if (verb === "upgrade") { upgrade(name); return }
    if (!Model.allowsVerb(Model.rowsFor([box])[0], verb, root.lock)) {
      if (DistroboxState.mutating) DistroboxState.lastError = DistroboxState.busyText()
      return
    }
    if (verb === "start") DistroboxState.start(name)
    else if (verb === "stop") DistroboxState.stop(name)
    else if (verb === "restart") DistroboxState.restart(name)
  }

  function toggleAtCursor() {
    if (!cursorActive || !cursorBox) return
    dispatch(cursorBox.name, cursorBox.up ? "stop" : "start")
  }

  // ---------------------------------------------------------- confirmation

  function ask(action, message, label) {
    root.confirmAction = action
    root.confirmMessage = message
    root.confirmLabel = label
    // Cancel is the default answer to every question asked here. The shell's
    // ConfirmDialog would otherwise default to its confirm button.
    confirmDialog.selectedIndex = 0
    root.confirmOpen = true
  }

  function askRemove(box) {
    if (DistroboxState.mutating) { DistroboxState.lastError = DistroboxState.busyText(); return }
    var name = box.name
    ask(function() { DistroboxState.remove(name) }, Model.removeMessage(box, DistroboxState.hostHome), "Delete")
  }

  function askStopAll() {
    if (DistroboxState.mutating) { DistroboxState.lastError = DistroboxState.busyText(); return }
    var running = DistroboxState.counts.running
    if (running === 0) return
    ask(function() { DistroboxState.stopAll() }, Model.stopAllMessage(running), "Stop all")
  }

  function closeConfirm() {
    root.confirmOpen = false
    root.confirmAction = null
  }

  function confirmAccepted() {
    var action = root.confirmAction
    closeConfirm()
    if (action) action()
  }

  // -------------------------------------------------------------- keyboard

  function moveCursor(delta) {
    // Up from the first row lands in the filter, the mirror of the Down key
    // that walks out of it.
    if (delta < 0 && cursorActive && cursorIndex === 0) {
      filterField.forceActiveFocus()
      cursorActive = false
      cursorKey = ""
      return
    }
    if (rows.length === 0) {
      filterField.forceActiveFocus()
      return
    }
    cursorActive = true
    cursorFromKeyboard = true
    rememberCursor(cursorIndex + delta)
  }

  // Hover names the box, not a row: while the list reconciles, a row number can
  // briefly point at a different box. A box no longer listed is ignored.
  function setCursorKey(key) {
    var index = -1
    for (var i = 0; i < rows.length; i++) if (rows[i].key === key) { index = i; break }
    if (index === -1) return
    cursorActive = true
    cursorFromKeyboard = false
    rememberCursor(index)
  }

  function handleTextKey(key) {
    if (key === "?") { root.helpOpen = !root.helpOpen; return }
    if (root.helpOpen) { root.helpOpen = false; return }
    if (key === "/") { filterField.forceActiveFocus(); return }
    if (key === "u") { DistroboxState.refresh(); return }
    if (key === "S") { askStopAll(); return }
    if (key === "U") { upgrade(null); return }
    if (key === "o") { openLog(); return }
    if (key === "c") { openForm(); return }

    if (!cursorActive || !cursorBox) return
    if (key === "e") dispatch(cursorBox.name, "enter")
    else if (key === "s") toggleAtCursor()
    else if (key === "r") { if (cursorBox.up) dispatch(cursorBox.name, "restart") }
    else if (key === "y") dispatch(cursorBox.name, "copy")
    else if (key === "p") dispatch(cursorBox.name, "promote")
    else if (key === "g") upgrade(cursorBox.name)
  }

  // ----------------------------------------------------------------- view

  // The confirmation lives outside PanelKeyCatcher on purpose: the catcher
  // goes `blocked` while a question is open, so the unhandled key bubbles
  // out to here and the dialog answers it.
  Item {
    id: keyRoot
    anchors.fill: parent

    Keys.onPressed: function(event) {
      if (!root.confirmOpen) return
      if (confirmDialog.handleKey(event)) event.accepted = true
    }

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: filterField.activeFocus || root.confirmOpen || root.mode !== "list"

      // KeyboardPanel focuses this catcher when the popup opens, on its own
      // schedule. Outside the list, send the keyboard on to whatever owns it,
      // so an IPC create that opens straight into the form keeps the form.
      onActiveFocusChanged: if (activeFocus && root.mode !== "list") Qt.callLater(root.focusForMode)

      onMoveRequested: function(dx, dy) {
        if (root.helpOpen) { if (dy !== 0) helpSheet.scroll(dy); return }
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: {
        if (root.helpOpen) root.helpOpen = false
        else if (root.cursorActive && root.cursorBox) root.dispatch(root.cursorBox.name, "enter")
      }
      onDeleteRequested: if (!root.helpOpen && root.cursorActive && root.cursorBox) root.askRemove(root.cursorBox)
      onCloseRequested: {
        if (root.helpOpen) root.helpOpen = false
        else root.closeRequested()
      }
      onTabRequested: function(direction) { root.switchPanelRequested(direction) }
      onTextKey: function(text) { root.handleTextKey(text) }

      Column {
        id: column
        anchors.fill: parent
        spacing: Style.spacing.panelGap

        PanelHero {
          title: "Distrobox"
          meta: Model.summaryText(DistroboxState.boxes, DistroboxState.reachable, DistroboxState.engine)
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconOpacity: DistroboxState.counts.running > 0 ? 1.0 : 0.5

          iconComponent: Text {
            text: Model.Glyph.box
            color: DistroboxState.counts.failing > 0 ? Color.urgent : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
          }

          trailingControl: Row {
            spacing: Style.spacing.sm

            PanelActionButton {
              iconText: Model.Glyph.keyboard
              tooltipText: "Keyboard shortcuts  (?)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.helpOpen = !root.helpOpen
            }

            PanelActionButton {
              iconText: Model.Glyph.refresh
              tooltipText: "Refresh  (u)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: DistroboxState.refresh()

              RotationAnimation on rotation {
                running: DistroboxState.loading
                from: 0
                to: 360
                duration: 900
                loops: Animation.Infinite
                onRunningChanged: if (!running) rotation = 0
              }
            }

            PanelActionButton {
              visible: DistroboxState.counts.running > 0
              enabled: !DistroboxState.mutating
              iconText: Model.Glyph.stop
              tooltipText: "Stop every running box  (S)"
              foreground: root.foreground
              hoverColor: Color.urgent
              fontFamily: root.fontFamily
              onClicked: root.askStopAll()
            }
          }
        }

        CreateForm {
          id: createForm
          visible: root.mode === "form"
          width: parent.width
          height: visible ? implicitHeight : 0
          boxes: DistroboxState.boxes
          fileTemplates: DistroboxState.userTemplates
          foreground: root.foreground
          fontFamily: root.fontFamily
          onSubmitted: function(form) { root.submitForm(form) }
          onCanceled: root.setMode("list")
        }

        LogView {
          id: logView
          visible: root.mode === "log"
          width: parent.width
          height: visible ? implicitHeight : 0
          lines: DistroboxState.log
          title: DistroboxState.streamTitle
          running: DistroboxState.streaming
          exitCode: DistroboxState.streamExit
          foreground: root.foreground
          fontFamily: root.fontFamily
          onBackRequested: root.setMode("list")
        }

        // A second instance, not new bindings on the one above: that one
        // belongs to the create / upgrade stream, and a promote must never
        // disturb a job in flight. exitCode -1 leaves the header's status
        // word blank, since nothing ran.
        LogView {
          id: snippetView
          visible: root.mode === "snippet"
          width: parent.width
          height: visible ? implicitHeight : 0
          lines: root.snippetLines
          title: "copied the snippet for " + root.snippetName
          running: false
          exitCode: -1
          foreground: root.foreground
          fontFamily: root.fontFamily
          onBackRequested: root.setMode("list")
        }

        TextField {
          id: filterField
          visible: root.mode === "list"
          width: parent.width
          foreground: root.foreground
          // The operator stays on the first line: a line that ends on a
          // complete expression gets a semicolon inserted for it, and the
          // rest of the binding is quietly dropped.
          placeholderText: Model.Glyph.search + "  Filter boxes" +
            (activeFocus ? "" : "   /")
          onTextChanged: {
            // A new filter starts from the top, not from a remembered box.
            root.cursorKey = ""
            root.filterText = text
            root.rememberCursor(0)
          }
          Keys.onEscapePressed: {
            if (text.length > 0) text = ""
            else keyCatcher.forceActiveFocus()
          }
          Keys.onDownPressed: {
            keyCatcher.forceActiveFocus()
            root.moveCursor(0)
          }
        }

        BoxList {
          id: list
          visible: root.mode === "list"
          width: parent.width
          rows: root.rows
          mutating: DistroboxState.mutating
          pendingName: DistroboxState.pendingName
          pendingVerb: DistroboxState.pendingVerb
          cursorIndex: root.cursorIndex
          cursorActive: root.cursorActive
          cursorFromKeyboard: root.cursorFromKeyboard
          foreground: root.foreground
          fontFamily: root.fontFamily

          onActionRequested: function(name, verb) { root.dispatch(name, verb) }
          onCursorRequested: function(key) { root.setCursorKey(key) }
        }

        Column {
          visible: root.mode === "list" && list.count === 0
          width: parent.width
          spacing: Style.spacing.sm
          topPadding: Style.spacing.lg
          bottomPadding: Style.spacing.lg

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: Model.emptyText({
              everLoaded: DistroboxState.everLoaded,
              reachable: DistroboxState.reachable,
              engine: DistroboxState.engine,
              filtered: root.filterText.trim() !== "",
              showStopped: DistroboxState.showStopped
            })
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Text {
            visible: !DistroboxState.reachable && DistroboxState.everLoaded
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: "Run  " + DistroboxState.engine + " info  to see what it found wrong, or pick the other engine in the widget's settings."
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
            lineHeight: 1.3
          }
        }

        // ------------------------------------------------------------ footer
        //
        // nixarchy-pkg's shape: a hairline, then one line for whatever went
        // wrong or is running, then counts on the left and keys on the right.

        Rectangle {
          width: parent.width
          height: Math.max(1, Style.space(1))
          color: root.dim
          opacity: 0.25
        }

        // distrobox's and the engine's refusals are more useful than anything
        // the panel could invent, so they get their own line until dismissed.
        Item {
          width: parent.width
          visible: DistroboxState.lastError !== ""
          implicitHeight: visible ? Math.max(errorText.implicitHeight, errorDismiss.height) : 0
          height: implicitHeight

          Text {
            id: errorGlyph
            anchors.left: parent.left
            anchors.top: parent.top
            text: Model.Glyph.alert
            textFormat: Text.PlainText
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.iconSmall
          }

          Text {
            id: errorText
            anchors.left: errorGlyph.right
            anchors.leftMargin: Style.spacing.md
            anchors.right: errorDismiss.left
            anchors.rightMargin: Style.spacing.md
            anchors.top: parent.top
            text: DistroboxState.lastError
            textFormat: Text.PlainText
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          PanelActionButton {
            id: errorDismiss
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.topMargin: -Style.spacing.xs
            iconText: Model.Glyph.close
            tooltipText: "Dismiss"
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.iconSmall
            size: Style.space(20)
            onClicked: DistroboxState.lastError = ""
          }
        }

        Text {
          width: parent.width
          visible: text !== "" && DistroboxState.lastError === "" && root.mode !== "log"
          text: {
            if (DistroboxState.streaming) return DistroboxState.streamTitle + " …   o to watch"
            if (DistroboxState.streamExit >= 0) {
              return DistroboxState.streamTitle + (DistroboxState.streamExit === 0 ? " finished" : " failed") +
                "   o shows the log"
            }
            return ""
          }
          textFormat: Text.PlainText
          color: DistroboxState.streaming ? Color.accent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }

        Item {
          width: parent.width
          implicitHeight: countsText.implicitHeight
          height: implicitHeight

          Text {
            id: countsText
            anchors.left: parent.left
            text: Model.footerText(DistroboxState.boxes)
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            anchors.right: parent.right
            text: DistroboxState.mutating ? "working…" : "? keys   c create   esc close"
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.65
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }

    ShortcutSheet {
      id: helpSheet
      anchors.fill: parent
      z: 5
      opened: root.helpOpen
      foreground: root.foreground
      background: Color.popups.background
      fontFamily: root.fontFamily
      onDismissed: root.helpOpen = false
    }

    ConfirmDialog {
      id: confirmDialog
      anchors.fill: parent
      z: 10
      opened: root.confirmOpen
      message: root.confirmMessage
      confirmText: root.confirmLabel
      background: Color.popups.background
      foreground: root.foreground
      fontFamily: root.fontFamily
      onCanceled: root.closeConfirm()
      onConfirmed: root.confirmAccepted()
    }
  }
}
