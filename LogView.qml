import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The output of a create or upgrade, as it arrives. It follows the end until
// you scroll; G or End goes back to following. Esc hides it and the job keeps
// running: `o` brings it back.
FocusScope {
  id: root

  property var lines: []
  property string title: ""
  property bool running: false
  property int exitCode: -1

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  // Set by the host: the menu passes 1.45, the bar popup leaves it 1.0.
  // A layout-time multiplier, never a `scale:` transform -- see DistroboxView.
  property real textScale: 1.0
  function px(base) { return Math.round(base * root.textScale) }

  readonly property color dim: Qt.darker(foreground, 1.5)

  property bool follow: true

  signal backRequested()
  signal cancelRequested()

  implicitHeight: header.implicitHeight + px(Style.spacing.md) + logList.height + px(Style.spacing.md) + hint.implicitHeight

  function toEnd() {
    root.follow = true
    logList.positionViewAtEnd()
  }

  function scroll(direction) {
    root.follow = false
    var step = px(Style.space(18)) * 3 * direction
    logList.contentY = Math.max(0, Math.min(logList.contentHeight - logList.height, logList.contentY + step))
    if (logList.atYEnd) root.follow = true
  }

  // Every append, even once the 400-line cap keeps the height constant.
  onLinesChanged: if (root.follow) Qt.callLater(function() { logList.positionViewAtEnd() })
  onVisibleChanged: if (visible) toEnd()

  Keys.onPressed: function(event) {
    var key = event.key
    if (key === Qt.Key_Escape) root.backRequested()
    // event.text, not a ShiftModifier bitmask: that is how PanelKeyCatcher
    // tells "x" from "X" too, and a modifier bitmask is not reliably set by
    // every input method or keymap. Tested on razer: the bitmask never
    // matched, so K did nothing in the log while it worked in the list.
    else if (event.text === "K") root.cancelRequested()
    else if (key === Qt.Key_J || key === Qt.Key_Down) root.scroll(1)
    else if (key === Qt.Key_K || key === Qt.Key_Up) root.scroll(-1)
    else if (key === Qt.Key_PageDown) root.scroll(8)
    else if (key === Qt.Key_PageUp) root.scroll(-8)
    else if (key === Qt.Key_G || key === Qt.Key_End) root.toEnd()
    else return
    event.accepted = true
  }

  Column {
    anchors.fill: parent
    spacing: px(Style.spacing.md)

    Row {
      id: header
      width: parent.width
      spacing: px(Style.spacing.md)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: Model.Glyph.logs
        textFormat: Text.PlainText
        color: root.running ? Color.accent : (root.exitCode > 0 ? Color.urgent : root.dim)
        font.family: root.fontFamily
        font.pixelSize: px(Style.font.iconSmall)
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width - px(Style.space(120))
        text: root.title
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: px(Style.font.body)
        elide: Text.ElideRight
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.running ? "running…" : (root.exitCode === 0 ? "done" : (root.exitCode > 0 ? "failed" : ""))
        textFormat: Text.PlainText
        color: root.running ? Color.accent : (root.exitCode > 0 ? Color.urgent : root.dim)
        font.family: root.fontFamily
        font.pixelSize: px(Style.font.caption)
      }
    }

    ListView {
      id: logList
      width: parent.width
      height: px(Style.space(340))
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      model: root.lines
      onMovementEnded: root.follow = atYEnd

      ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

      delegate: Text {
        required property var modelData
        width: ListView.view.width
        text: modelData
        textFormat: Text.PlainText
        // Break at words; a long hash with no spaces still breaks anywhere.
        wrapMode: Text.Wrap
        color: String(modelData).indexOf("── exit") === 0 ? (root.exitCode > 0 ? Color.urgent : Color.accent) : root.dim
        font.family: root.fontFamily
        font.pixelSize: px(Style.font.caption)
      }
    }

    Text {
      id: hint
      width: parent.width
      horizontalAlignment: Text.AlignRight
      text: Model.logHint(root.follow, logList.contentHeight > logList.height, root.running)
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.65
      font.family: root.fontFamily
      font.pixelSize: px(Style.font.caption)
    }
  }
}
