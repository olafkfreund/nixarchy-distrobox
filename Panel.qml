import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The bar widget: a glyph that keeps an eye on your boxes, and a keyboard
// popup under it. The data lives in the DistroboxState singleton, shared with
// the full-screen menu (Menu.qml).
Panel {
  id: root

  moduleName: "nixarchy.distrobox"
  ipcTarget: "nixarchy.distrobox.bar"
  manageIpc: false

  readonly property int refreshIntervalSec: Math.max(5, Number(setting("refreshIntervalSec", 30)))
  readonly property bool showStopped: setting("showStopped", true) === true
  readonly property string containerManager: String(setting("containerManager", "podman"))
  readonly property bool hideWhenEmpty: setting("hideWhenEmpty", false) === true
  readonly property string templatesFile: String(setting("templatesFile", "~/.config/distrobox/boxes.ini"))

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function pushSettings() {
    DistroboxState.settings = {
      refreshIntervalSec: root.refreshIntervalSec,
      showStopped: root.showStopped,
      containerManager: root.containerManager,
      templatesFile: root.templatesFile
    }
  }

  onRefreshIntervalSecChanged: pushSettings()
  onShowStoppedChanged: pushSettings()
  onContainerManagerChanged: pushSettings()
  onTemplatesFileChanged: pushSettings()

  Component.onCompleted: {
    pushSettings()
    DistroboxState.acquire("bar")
  }
  Component.onDestruction: {
    DistroboxState.release("bar")
    if (root.opened) DistroboxState.release("view")
  }

  onOpenedChanged: {
    if (opened) {
      DistroboxState.acquire("view")
      view.reset()
    } else {
      DistroboxState.release("view")
      view.dismiss()
    }
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { DistroboxState.refresh() }
    function stopAll(): void { DistroboxState.stopAll() }
    function create(): void {
      root.open()
      view.openForm()
    }
    function start(name: string): void { DistroboxState.start(name) }
    function status(): string { return DistroboxState.statusJson() }
  }

  // ------------------------------------------------------------------- bar

  implicitWidth: button.visible ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: Model.Glyph.box
    visible: !root.hideWhenEmpty || DistroboxState.counts.total > 0
    dimmed: DistroboxState.counts.running === 0
    active: DistroboxState.counts.running > 0 || DistroboxState.mutating
    useActiveColor: true
    activeColor: DistroboxState.counts.failing > 0 ? Color.urgent : Color.accent
    tooltipText: "Distrobox · " + Model.summaryText(DistroboxState.boxes, DistroboxState.reachable, DistroboxState.engine)

    onPressed: function(b) {
      if (b === Qt.MiddleButton) DistroboxState.refresh()
      else root.toggle()
    }
  }

  // ----------------------------------------------------------------- panel

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: view.keyTarget
    contentWidth: panel.fittedContentWidth(Style.space(470))
    contentHeight: panel.fittedContentHeight(view.implicitHeight)

    DistroboxView {
      id: view
      anchors.fill: parent
      foreground: root.foreground
      fontFamily: root.fontFamily
      onCloseRequested: root.close()
      onSwitchPanelRequested: function(direction) { root.switchPanel(direction) }
    }
  }
}
