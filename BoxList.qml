import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The list of boxes. Rows come from Model.rowsFor; the ListModel is reconciled
// rather than reassigned, so a status line going from "Up 59 seconds" to
// "Up About a minute" updates in place instead of rebuilding the delegate and
// dropping the hover state under the cursor.
Item {
  id: root

  property var rows: []
  property bool mutating: false
  property string pendingName: ""
  property string pendingVerb: ""

  property int cursorIndex: 0
  property bool cursorActive: false
  property bool cursorFromKeyboard: false

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family


  // Resolved by DistroboxView from its token set; never computed here.
  property int fontRow: Style.font.caption
  property int fontLabel: Style.font.body
  property int fontIcon: Style.font.icon
  property int fontGlyph: Style.font.iconSmall
  property int fontHero: Style.font.display


  property int maxHeight: Style.space(520)

  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property int count: rowModel.count

  signal actionRequested(string name, string verb)
  signal cursorRequested(string key)

  width: parent ? parent.width : implicitWidth
  implicitHeight: listView.height
  height: implicitHeight

  ListModel { id: rowModel }

  function sync() {
    var next = root.rows || []
    var keys = []
    for (var i = 0; i < rowModel.count; i++) keys.push(rowModel.get(i).key)

    var ops = Model.reconcilePlan(keys, next)
    for (var o = 0; o < ops.length; o++) {
      var op = ops[o]
      if (op.op === "remove") rowModel.remove(op.index)
      else if (op.op === "move") rowModel.move(op.from, op.to, 1)
      else rowModel.insert(op.index, Model.rowRecord(op.row))
    }

    for (var n = 0; n < next.length; n++) {
      var record = Model.rowRecord(next[n])
      var current = rowModel.get(n)
      for (var f = 0; f < Model.ROW_FIELDS.length; f++) {
        var field = Model.ROW_FIELDS[f]
        if (current[field] !== record[field]) rowModel.setProperty(n, field, record[field])
      }
    }
  }

  onRowsChanged: sync()
  Component.onCompleted: sync()

  ListView {
    id: listView

    width: parent.width
    height: rowModel.count > 0 ? Math.min(contentHeight, root.maxHeight) : 0
    visible: rowModel.count > 0
    spacing: Style.spacing.sm
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    model: rowModel
    currentIndex: root.cursorIndex

    onCurrentIndexChanged: {
      if (currentIndex >= 0 && root.cursorFromKeyboard) Qt.callLater(keepCurrentVisible)
    }
    function keepCurrentVisible() {
      if (currentIndex >= 0 && root.cursorFromKeyboard) positionViewAtIndex(currentIndex, ListView.Contain)
    }

    delegate: BoxRow {
      required property var model
      required property int index

      width: ListView.view.width
      row: model
      rowIndex: index
    }
  }

  component BoxRow: CursorSurface {
    id: rowSurface

    required property var row
    required property int rowIndex

    readonly property bool rowPending: root.pendingName === rowSurface.row.name && root.pendingVerb !== ""
    readonly property var actions: Model.actionsFor(rowSurface.row, { mutating: root.mutating })

    hasCursor: root.cursorActive && rowIndex === root.cursorIndex
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.xxl
    height: implicitHeight
    opacity: rowSurface.rowPending ? 0.7 : 1.0

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton
      cursorShape: Qt.PointingHandCursor
      onContainsMouseChanged: if (containsMouse) root.cursorRequested(rowSurface.row.key)
      onClicked: root.actionRequested(rowSurface.row.name, "enter")
    }

    PanelToolTip {
      fontSize: root.fontLabel
      visible: rowMouse.containsMouse
      text: "Enter " + rowSurface.row.name + " in a terminal  (enter)"
      fontFamily: root.fontFamily
    }

    Item {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.spacing.xl
      anchors.rightMargin: Style.spacing.xl
      implicitHeight: Math.max(identity.implicitHeight, rowActions.implicitHeight)

      Rectangle {
        id: stateDot
        width: Style.space(7)
        height: width
        radius: width / 2
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        color: rowSurface.row.failing ? Color.urgent
          : (rowSurface.row.up ? Color.accent : "transparent")
        border.width: !rowSurface.row.up && !rowSurface.row.failing ? 1 : 0
        border.color: root.dim

        SequentialAnimation on opacity {
          running: rowSurface.rowPending
          loops: Animation.Infinite
          NumberAnimation { to: 0.25; duration: 600; easing.type: Easing.InOutQuad }
          NumberAnimation { to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
          onRunningChanged: if (!running) stateDot.opacity = 1
        }
      }

      Column {
        id: identity
        anchors.left: stateDot.right
        anchors.leftMargin: Style.spacing.xl
        anchors.right: rowActions.left
        anchors.rightMargin: Style.spacing.lg
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.spacing.xxs

        Text {
          width: parent.width
          text: rowSurface.row.name
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: root.fontLabel
          font.bold: rowSurface.row.up
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          text: rowSurface.row.subtitle
          textFormat: Text.PlainText
          visible: text !== ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: root.fontRow
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          visible: text !== ""
          text: rowSurface.rowPending ? root.pendingVerb + "…"
            : (rowSurface.row.up ? "" : rowSurface.row.status)
          textFormat: Text.PlainText
          color: rowSurface.rowPending ? Color.accent
            : (rowSurface.row.failing ? Color.urgent : root.dim)
          font.family: root.fontFamily
          font.pixelSize: root.fontRow
          elide: Text.ElideRight
        }
      }

      Row {
        id: rowActions
        anchors.right: parent.right
        anchors.rightMargin: Style.spacing.md
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.spacing.xxs

        Repeater {
          model: rowSurface.actions

          delegate: PanelActionButton {
            required property var modelData

            enabled: modelData.enabled
            opacity: modelData.enabled ? 1.0 : 0.4
            iconText: modelData.glyph
            tooltipText: modelData.tooltip
            foreground: root.foreground
            hoverColor: modelData.danger ? Color.urgent : root.foreground
            fontFamily: root.fontFamily
            fontSize: root.fontGlyph
            size: Style.space(22)
            onClicked: root.actionRequested(rowSurface.row.name, modelData.verb)
          }
        }
      }
    }
  }
}
