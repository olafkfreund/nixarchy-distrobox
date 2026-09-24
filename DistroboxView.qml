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

  // How big the text is, chosen by the host as a SET OF TOKENS, never a
  // factor. The shell already scales every Style.font.* from [font] base-size
  // (omarchy display text size), so a multiplier on top would keep this
  // surface a fixed percentage above the rest of the desktop at every
  // setting, and would override a theme that pins a token.
  //
  // The menu is bigger because it sits a rung or two higher on the shell's
  // own ladder; the bar popup keeps the base rungs. Nothing multiplies.
  property bool large: false

  readonly property int fontRow:   large ? Style.font.title        : Style.font.caption
  readonly property int fontLabel: large ? Style.font.heading      : Style.font.body
  readonly property int fontIcon:  large ? Style.font.heading      : Style.font.icon
  readonly property int fontGlyph: large ? Style.font.title        : Style.font.iconSmall
  readonly property int fontHero:  large ? Style.font.displayLarge : Style.font.display

  readonly property color dim: Qt.darker(foreground, 1.5)

  // KeyboardPanel focuses this directly: handing it the FocusScope instead
  // would restore whichever child held focus last, stale filter field included.
  readonly property alias keyTarget: keyCatcher

  implicitHeight: column.implicitHeight

  // How much room is left for the one variable-height child of the current
  // mode, out of the height the host gave us.
  //
  // The binding flows strictly DOWNWARDS from root.height. It must never read
  // column.implicitHeight, or it would depend on the very children whose size
  // it decides and Qt would report a binding loop and oscillate. So the chrome
  // is summed from the siblings only, skipping the four variable children --
  // which also means a fixed row added later is counted without touching this.
  readonly property int fixedChrome: {
    var total = 0
    for (var i = 0; i < column.children.length; i++) {
      var child = column.children[i]
      if (!child.visible) continue
      if (child === list || child === createForm || child === logView || child === snippetView) continue
      total += child.height + column.spacing
    }
    return total
  }

  // The most this view may occupy, set by the host from the SCREEN.
  //
  // Deliberately not root.height. The menu sizes its card from
  // view.implicitHeight, so reading our own assigned height back would close a
  // cycle: card.height -> implicitHeight -> availableContent -> height ->
  // card.height. Taking the budget from the panel instead means the binding
  // depends only on the monitor, which nothing downstream can feed.
  // 0 means "unbounded": the bar popup sizes itself from implicitHeight.
  property int availableHeight: 0

  // A floor so a very short screen still shows something, and a fallback to
  // what these were fixed at before for an unbounded host.
  readonly property int availableContent: root.availableHeight > 0
    ? Math.max(Style.space(120), root.availableHeight - root.fixedChrome)
    : Style.space(520)

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
  // Which button is selected: 0 Cancel, 1 the destructive one.
  property int confirmIndex: 0
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
    // "Busy … press o to watch" has done its job once you are watching.
    DistroboxState.clearBusyNotice()
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
    // Cancel is the default answer to every question asked here -- the
    // shell's ConfirmDialog defaulted to its confirm button, and this kept
    // that from being true for a delete.
    root.confirmIndex = 0
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
    var next = Model.stepCursor(cursorActive, cursorIndex, delta, rows.length)
    cursorActive = true
    cursorFromKeyboard = true
    rememberCursor(next)
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
    // Before the cursor guard: the lock can be held with nothing selected,
    // and that is exactly when the user needs the way out of it.
    //
    // K, not X: PanelKeyCatcher turns both "x" and "X" into deleteRequested
    // before textKey ever sees them, so X here would be dead code that also
    // opened a delete prompt. It matches "j"/"k" lowercase only, so "K" gets
    // through -- and a missed shift is just a cursor move.
    if (key === "K") { DistroboxState.cancel(); return }
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

        // The shell's PanelHero, drawn here instead of used, because its
        // title and meta font sizes are internal (PanelHero.qml:57,98) and
        // cannot be multiplied from outside. Under the old `scale:` transform
        // they magnified with everything else; under a layout multiplier they
        // would stay at base size and the header would read ~26% small against
        // the body. Same layout and the same tokens, only sized through .
        // If omarchy ever exposes those sizes, delete this and go back.
        Item {
          id: hero
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, heroTrailing.implicitHeight)

          Text {
            id: heroIcon
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: Model.Glyph.box
            color: DistroboxState.counts.failing > 0 ? Color.urgent : root.foreground
            opacity: DistroboxState.counts.running > 0 ? 1.0 : 0.5
            font.family: root.fontFamily
            font.pixelSize: root.fontHero
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.rightMargin: heroTrailing.width + Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: "Distrobox"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: root.fontIcon
              font.bold: true
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: Model.summaryText(DistroboxState.boxes, DistroboxState.reachable, DistroboxState.engine).toUpperCase()
              visible: text !== ""
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: root.fontRow
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
            }
          }

          Row {
            id: heroTrailing
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.spacing.sm

            PanelActionButton {
              fontSize: root.fontIcon
              iconText: Model.Glyph.keyboard
              tooltipText: "Keyboard shortcuts  (?)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.helpOpen = !root.helpOpen
            }

            PanelActionButton {
              fontSize: root.fontIcon
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
              fontSize: root.fontIcon
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
          fontRow: root.fontRow
          fontLabel: root.fontLabel
          fontIcon: root.fontIcon
          fontGlyph: root.fontGlyph
          fontHero: root.fontHero
          maxHeight: root.availableContent
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
          fontRow: root.fontRow
          fontLabel: root.fontLabel
          fontIcon: root.fontIcon
          fontGlyph: root.fontGlyph
          fontHero: root.fontHero
          maxHeight: root.availableContent
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
          onCancelRequested: DistroboxState.cancel()
        }

        // A second instance, not new bindings on the one above: that one
        // belongs to the create / upgrade stream, and a promote must never
        // disturb a job in flight. exitCode -1 leaves the header's status
        // word blank, since nothing ran.
        LogView {
          id: snippetView
          fontRow: root.fontRow
          fontLabel: root.fontLabel
          fontIcon: root.fontIcon
          fontGlyph: root.fontGlyph
          fontHero: root.fontHero
          maxHeight: root.availableContent
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
          fontRow: root.fontRow
          fontLabel: root.fontLabel
          fontIcon: root.fontIcon
          fontGlyph: root.fontGlyph
          fontHero: root.fontHero
          maxHeight: root.availableContent
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
            font.pixelSize: root.fontLabel
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
            font.pixelSize: root.fontRow
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
            font.pixelSize: root.fontGlyph
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
            font.pixelSize: root.fontRow
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
            fontSize: root.fontGlyph
            size: Style.space(20)
            onClicked: DistroboxState.lastError = ""
          }
        }

        Text {
          width: parent.width
          visible: text !== "" && DistroboxState.lastError === "" && root.mode === "list"
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
          font.pixelSize: root.fontRow
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
            font.pixelSize: root.fontRow
          }

          Text {
            anchors.right: parent.right
            text: Model.footerKeys(root.mode, DistroboxState.mutating)
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.65
            font.family: root.fontFamily
            font.pixelSize: root.fontRow
          }
        }
      }
    }

    ShortcutSheet {
      id: helpSheet
      fontRow: root.fontRow
      fontLabel: root.fontLabel
      fontIcon: root.fontIcon
      fontGlyph: root.fontGlyph
      fontHero: root.fontHero
      anchors.fill: parent
      z: 5
      opened: root.helpOpen
      foreground: root.foreground
      background: Color.popups.background
      fontFamily: root.fontFamily
      onDismissed: root.helpOpen = false
    }

    // The shell's ConfirmDialog, drawn here for the same reason as the hero
    // above: it exposes no size property, so a layout multiplier cannot reach
    // its message or its buttons. Same layout, same tokens, sized through .
    Item {
      id: confirmDialog
      anchors.fill: parent
      z: 10
      visible: root.confirmOpen

      // Called by keyRoot, which gets the key because PanelKeyCatcher goes
      // `blocked` while a question is open.
      function handleKey(event) {
        if (!root.confirmOpen) return false
        if (event.key === Qt.Key_Escape) { root.closeConfirm(); return true }
        if (event.key === Qt.Key_Left || event.key === Qt.Key_Right
            || event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
          root.confirmIndex = root.confirmIndex === 0 ? 1 : 0
          return true
        }
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          if (root.confirmIndex === 0) root.closeConfirm()
          else root.confirmAccepted()
          return true
        }
        return false
      }

      Rectangle {
        anchors.fill: parent
        color: Util.alpha(Color.background, 0.7)

        MouseArea { anchors.fill: parent; onClicked: root.closeConfirm() }

        BorderSurface {
          id: confirmCard
          width: Math.min(parent.width - Style.space(32), Style.space(370))
          // Grows with the wrapped message, so a narrow host does not squeeze
          // the text into the buttons.
          height: confirmCard.contentTopInset + confirmCard.contentBottomInset
                  + confirmMessageText.implicitHeight + Style.space(20) + Style.space(34)
          anchors.centerIn: parent
          color: Color.popups.background
          borderSpec: Border.flat(Color.accent, Style.normalBorderWidth)
          padding: Style.space(18)
          radius: Style.cornerRadius

          MouseArea { anchors.fill: parent; onClicked: {} }

          Item {
            anchors.fill: parent
            anchors.topMargin: confirmCard.contentTopInset
            anchors.rightMargin: confirmCard.contentRightInset
            anchors.bottomMargin: confirmCard.contentBottomInset
            anchors.leftMargin: confirmCard.contentLeftInset

            Text {
              id: confirmMessageText
              textFormat: Text.PlainText
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.top: parent.top
              text: root.confirmMessage
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: root.fontIcon
              wrapMode: Text.WordWrap
            }

            Row {
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              spacing: Style.space(10)

              Repeater {
                model: ["Cancel", root.confirmLabel]

                BorderSurface {
                  required property int index
                  required property string modelData

                  readonly property bool selected: root.confirmIndex === index
                  readonly property bool destructive: index === 1

                  width: Style.space(88)
                  height: Style.space(34)
                  color: selected
                    ? (destructive ? Util.alpha(Color.urgent, 0.22)
                                   : Util.alpha(root.foreground, 0.08))
                    : "transparent"
                  borderSpec: Border.flat(destructive
                    ? (selected ? Color.urgent : Util.alpha(Color.urgent, 0.56))
                    : (selected ? Color.accent : Util.alpha(root.foreground, 0.38)),
                    Style.normalBorderWidth)
                  radius: 0

                  Text {
                    textFormat: Text.PlainText
                    anchors.centerIn: parent
                    text: modelData
                    color: destructive ? (selected ? Color.urgent : root.foreground)
                                       : (selected ? Color.accent : root.foreground)
                    font.family: root.fontFamily
                    font.pixelSize: root.fontRow
                  }

                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: root.confirmIndex = index
                    onClicked: {
                      if (index === 0) root.closeConfirm()
                      else root.confirmAccepted()
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
