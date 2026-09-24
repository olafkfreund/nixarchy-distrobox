import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Distrobox on a keybind or a menu row, over whatever you were working in.
//
// The same list, form and log as the bar popup (it hosts the same
// DistroboxView, over the same DistroboxState), but it does not need the
// widget to be in the bar, and it holds the keyboard for as long as it is up.
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

  // A full-screen surface is read from further away than a bar popup, so it
  // is drawn larger -- but by picking LARGER TOKENS, never by a factor.
  //
  // `large: true` on the view moves each of its named text roles up a rung of
  // the shell's own ladder, and the card is wider because viewWidth is 680
  // where the popup's is 470. Both of those already scale with [font]
  // base-size (omarchy display text size), so the menu now moves in step with
  // the rest of the desktop instead of sitting a fixed 45% above it, and a
  // theme that pins a font token is honoured.
  //
  // Two things not to reintroduce. A `scale:` transform (what this was
  // originally) magnifies the view after layout, so wrapping and eliding are
  // computed at the wrong size and then stretched. A flat multiplier (what
  // replaced it) keeps this surface a fixed percentage above every other one
  // at every text size, and overrides a pinned token. `nix flake check` has a
  // `no-text-multiplier` check that fails on either.
  readonly property int viewWidth: Style.space(680)

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

  function wantsCreate(payloadJson) {
    try {
      var payload = JSON.parse(String(payloadJson || "{}"))
      return !!(payload && payload.create === true)
    } catch (e) {
      return false
    }
  }

  // Plugin lifecycle: the host calls open(payloadJson) on summon and close()
  // on hide, and reads `opened` to decide what `toggle` means. keepLoaded, so
  // every open starts from a clean slate.
  function open(payloadJson) {
    DistroboxState.settings = root.readSettings()
    root.targetScreen = root.focusedScreen()
    if (!root.opened) DistroboxState.acquire("view")
    view.reset()
    if (root.wantsCreate(payloadJson)) view.openForm()
    root.opened = true
  }

  function close() {
    if (root.opened) DistroboxState.release("view")
    view.dismiss()
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

    onVisibleChanged: if (visible) Qt.callLater(function() { view.focusForMode() })

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    // A click away closes, as every summoned surface here does. The card
    // swallows its own clicks so they never reach this.
    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    BorderSurface {
      id: card
      width: Math.min(root.viewWidth + card.contentLeftInset + card.contentRightInset,
                      Math.round(panel.width * 0.9))
      height: Math.min(view.implicitHeight + card.contentTopInset + card.contentBottomInset,
                       Math.round(panel.height * 0.8))
      anchors.horizontalCenter: parent.horizontalCenter
      // A fixed top edge: the card grows and shrinks downwards only, so it
      // does not jump while the filter changes the list's height.
      y: Math.max(Style.gapsOut, Math.round(panel.height * 0.12))
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.popupPadding
      radius: Style.cornerRadius

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: frame
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        clip: true

        DistroboxView {
          id: view
          // Laid out at the size the frame actually has, so text wraps and
          // elides at the width it is drawn at.
          width: frame.width
          height: frame.height
          large: true
          // The room the monitor allows, matching the card's own 0.8 clamp.
          // From panel.height, never from frame.height: the card is sized from
          // this view's implicitHeight, so feeding our own height back in would
          // be a binding loop.
          availableHeight: Math.round(panel.height * 0.8)
                           - card.contentTopInset - card.contentBottomInset
          foreground: Color.foreground
          fontFamily: Style.font.family
          onCloseRequested: root.close()
          // No neighbouring bar panel to hand over to.
          onSwitchPanelRequested: function(direction) {}
        }
      }
    }
  }
}
