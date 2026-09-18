import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Distrobox on a keybind or a menu row, over whatever you were working in.
//
//   omarchy-shell shell toggle nixarchy.distrobox '{}'
//   omarchy-shell shell toggle nixarchy.distrobox '{"create":true}'
Item {
  id: root

  // Injected by omarchy-shell when this plugin is summoned.
  property var shell: null
  property var manifest: null

  property bool opened: false
  property var targetScreen: null

  function focusedScreen() {
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++)
      if (screens[i].name === name) return screens[i]
    return null
  }

  function readSettings() {
    var defaults = manifest && manifest.barWidget && manifest.barWidget.defaults
      ? manifest.barWidget.defaults : ({})
    var id = manifest && manifest.id ? manifest.id : "nixarchy.distrobox"
    return Model.settingsFor(shell ? shell.barConfig : null, id, defaults)
  }

  function open(payloadJson) {
    DistroboxState.settings = root.readSettings()
    root.targetScreen = root.focusedScreen()
    if (!root.opened) DistroboxState.acquire("view")
    root.opened = true
  }

  function close() {
    if (root.opened) DistroboxState.release("view")
    root.opened = false
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  // `omarchy-shell shell call nixarchy.distrobox status ''`
  function status() { return DistroboxState.statusJson() }

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "nixarchy-distrobox-menu"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle { anchors.fill: parent; color: Color.menu.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.close() }
  }
}
