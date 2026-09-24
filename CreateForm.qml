import QtQuick
import QtQuick.Controls
import qs.Ui
import qs.Commons
import "Model.js" as Model

// The create form: every `distrobox create` flag, the common ones first and
// the rest behind Advanced. Keyboard only, the way nixarchy-pkg's OptionForm
// works: this scope owns the keyboard while it is open.
//
// Navigation is one function, navKey(), which every field forwards to. A text
// field keeps every printable key for itself (j and k included); Tab, the
// arrows, Enter and Esc mean the same thing everywhere.
//
// No Popup anywhere: the image picker is an inline list under the field. A
// Popup is reparented to the overlay and would ignore the menu's scale.
FocusScope {
  id: root

  property var boxes: []
  // The user's own templates from the assemble file (#8), after the built-ins.
  property var fileTemplates: []
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  // Set by the host: the menu passes 1.45, the bar popup leaves it 1.0.
  // A layout-time multiplier, never a `scale:` transform -- see DistroboxView.
  property real textScale: 1.0
  function px(base) { return Math.round(base * root.textScale) }

  // Resolved by DistroboxView from its token set; never computed here.
  property int fontRow: Style.font.caption
  property int fontLabel: Style.font.body
  property int fontIcon: Style.font.icon
  property int fontGlyph: Style.font.iconSmall
  property int fontHero: Style.font.display


  // Set by the host from the room it actually has; the default is what this
  // was fixed at before, for a host that assigns nothing.
  property int maxHeight: px(Style.space(400))

  readonly property color dim: Qt.darker(foreground, 1.5)

  signal submitted(var form)
  signal canceled()

  // ------------------------------------------------------------------ state

  property var form: Model.emptyForm()
  property bool advanced: false
  property int fieldIndex: 0
  // Errors show once a field has been left, or after Enter was tried.
  property var touched: ({})
  property bool attempted: false
  // -1: the image field itself; 0..n: a row of the image list under it.
  property int imageIndex: -1
  // The same for the "Start from" list, plus what has been typed to filter it
  // (that row is not a text field, so its typing is kept here).
  property int templateIndex: -1
  property string templateFilter: ""
  // Why a picked file template could not be used; cleared on the next move.
  property string templateNotice: ""

  readonly property var fields: Model.visibleFields(advanced)
  readonly property var current: fieldIndex >= 0 && fieldIndex < fields.length ? fields[fieldIndex] : null
  readonly property var check: Model.validateForm(form, boxes)
  readonly property var stoppedNames: Model.stoppedBoxNames(boxes)
  readonly property var imageChoices: Model.imagesMatching(form.image === Model.DEFAULT_IMAGE ? "" : form.image).slice(0, 6)
  readonly property var templateChoices: Model.templateChoices(templateFilter, fileTemplates)
  readonly property string templateLabel: {
    var t = Model.templateById(form.template)
    if (t) return t.label
    return String(form.template).indexOf("file:") === 0 ? form.template.substring(5) + " (yours)" : "Blank"
  }

  implicitHeight: formColumn.implicitHeight

  // Called every time the form opens: a clean form, cursor on the name.
  function start() {
    root.form = Model.emptyForm()
    root.advanced = false
    root.touched = ({})
    root.attempted = false
    root.imageIndex = -1
    root.templateIndex = -1
    root.templateFilter = ""
    root.templateNotice = ""
    root.fieldIndex = 0
    Qt.callLater(root.focusCurrent)
  }

  function setValue(key, value) {
    var next = Object.assign({}, root.form)
    next[key] = value
    root.form = next
  }

  function showError(key) {
    return (root.attempted || root.touched[key] === true) && root.check.errors[key] ? root.check.errors[key] : ""
  }

  // Not root.forceActiveFocus() for a switch row: on a FocusScope that hands
  // focus back to the child that had it last, which is the text field just
  // left, and the next space would be typed into it. The sink holds the
  // keyboard instead; its keys bubble up to the handler below.
  function focusCurrent() {
    var item = fieldRepeater.itemAt(root.fieldIndex)
    if (item && item.takesText) item.takeFocus()
    else keySink.forceActiveFocus()
    if (item) flick.ensureVisible(item)
  }

  function moveField(delta) {
    if (root.current) {
      var t = Object.assign({}, root.touched)
      t[root.current.key] = true
      root.touched = t
    }
    root.imageIndex = -1
    root.templateIndex = -1
    root.templateFilter = ""
    root.templateNotice = ""
    var next = root.fieldIndex + delta
    // Unshare rows under "everything" are inert while it is on.
    while (next >= 0 && next < root.fields.length && root.fields[next].underAll && root.form.unshareAll) next += delta
    root.fieldIndex = Math.max(0, Math.min(root.fields.length - 1, next))
    Qt.callLater(root.focusCurrent)
  }

  function activate() {
    var f = root.current
    if (!f) return
    if (f.kind === "bool") {
      if (f.underAll && root.form.unshareAll) return
      // Init carries the chosen template's init packages with it.
      if (f.key === "init") root.form = Model.setInit(root.form, !root.form.init)
      else setValue(f.key, !root.form[f.key])
    } else if (f.kind === "template") {
      root.templateIndex = root.templateIndex >= 0 ? -1 : 0
    } else if (f.kind === "section") {
      root.advanced = !root.advanced
    } else if (f.kind === "clone") {
      setValue("clone", Model.nextClone(root.form.clone, root.stoppedNames))
    }
  }

  function submit() {
    root.attempted = true
    if (!root.check.ok) {
      // Errors may sit behind Advanced: open it, then land on the first one.
      var all = Model.visibleFields(true)
      var first = Model.firstErrorIndex(all, root.check.errors)
      if (first !== -1 && all[first].advanced) root.advanced = true
      var shown = Model.visibleFields(root.advanced)
      var at = Model.firstErrorIndex(shown, root.check.errors)
      if (at !== -1) root.fieldIndex = at
      Qt.callLater(root.focusCurrent)
      return
    }
    root.submitted(Object.assign({}, root.form))
  }

  function pickTemplate(index) {
    if (index < 0 || index >= root.templateChoices.length) return
    var choice = root.templateChoices[index]
    if (choice.source === "file") {
      // A section the checks refused is listed, but picking it changes
      // nothing; it says why instead.
      if (!choice.usable) {
        root.templateNotice = choice.label + ": " + choice.reasons[0]
        return
      }
      root.form = Model.applyFileTemplate(root.form, choice)
    } else {
      root.form = Model.applyTemplate(root.form, choice.id)
    }
    root.templateNotice = ""
    root.templateIndex = -1
    root.templateFilter = ""
  }

  function pickImage(index) {
    if (index < 0 || index >= root.imageChoices.length) return
    setValue("image", root.imageChoices[index].value)
    root.imageIndex = -1
  }

  // The one place a navigation key is decided. Returns true when handled.
  function navKey(event) {
    var key = event.key
    var onImage = root.current && root.current.kind === "image"
    var onTemplate = root.current && root.current.kind === "template"
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0

    if (key === Qt.Key_Escape) {
      if (onImage && root.imageIndex >= 0) root.imageIndex = -1
      else if (onTemplate && (root.templateIndex >= 0 || root.templateFilter !== "")) {
        root.templateIndex = -1
        root.templateFilter = ""
      }
      else root.canceled()
      return true
    }
    if (key === Qt.Key_Tab && !shift) { moveField(1); return true }
    if (key === Qt.Key_Backtab || (key === Qt.Key_Tab && shift)) { moveField(-1); return true }
    if (key === Qt.Key_Down) {
      if (onImage && root.imageIndex < root.imageChoices.length - 1) { root.imageIndex += 1; return true }
      if (onTemplate && root.templateIndex < root.templateChoices.length - 1) { root.templateIndex += 1; return true }
      moveField(1)
      return true
    }
    if (key === Qt.Key_Up) {
      if (onImage && root.imageIndex >= 0) { root.imageIndex -= 1; return true }
      if (onTemplate && root.templateIndex >= 0) { root.templateIndex -= 1; return true }
      moveField(-1)
      return true
    }
    if (key === Qt.Key_Return || key === Qt.Key_Enter) {
      if (onImage && root.imageIndex >= 0) { pickImage(root.imageIndex); return true }
      if (onTemplate && root.templateIndex >= 0) { pickTemplate(root.templateIndex); return true }
      if (root.current && root.current.kind === "section") { activate(); return true }
      submit()
      return true
    }
    return false
  }

  // Keys that reach the scope itself: every row that is not a text field.
  Keys.onPressed: function(event) {
    if (root.navKey(event)) { event.accepted = true; return }
    // On "Start from", typing filters the list (j and k included); the row is
    // not a text field, so the filter lives in templateFilter.
    if (root.current && root.current.kind === "template") {
      if (event.key === Qt.Key_Backspace) {
        root.templateFilter = root.templateFilter.slice(0, -1)
        event.accepted = true
        return
      }
      if (event.text.length === 1 && /[A-Za-z0-9 ._-]/.test(event.text) && event.key !== Qt.Key_Space) {
        root.templateFilter += event.text
        root.templateIndex = root.templateChoices.length > 0 ? 0 : -1
        event.accepted = true
        return
      }
    }
    if (event.key === Qt.Key_Space) { root.activate(); event.accepted = true; return }
    if (event.key === Qt.Key_J) { root.moveField(1); event.accepted = true; return }
    if (event.key === Qt.Key_K) { root.moveField(-1); event.accepted = true; return }
  }

  Item { id: keySink }

  Column {
    id: formColumn
    anchors.fill: parent
    spacing: px(Style.spacing.md)

    Row {
      width: parent.width
      spacing: px(Style.spacing.md)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: Model.Glyph.plus
        textFormat: Text.PlainText
        color: Color.accent
        font.family: root.fontFamily
        font.pixelSize: root.fontGlyph
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "New box"
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: root.fontLabel
        font.bold: true
      }
    }

    Flickable {
      id: flick
      width: parent.width
      height: Math.min(fieldsColumn.implicitHeight, root.maxHeight)
      contentHeight: fieldsColumn.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds

      ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

      function ensureVisible(item) {
        var y = item.mapToItem(fieldsColumn, 0, 0).y
        if (y < contentY) contentY = y
        else if (y + item.height > contentY + height) contentY = y + item.height - height
      }

      Column {
        id: fieldsColumn
        width: flick.width - px(Style.spacing.md)
        spacing: px(Style.spacing.xs)

        Repeater {
          id: fieldRepeater
          model: root.fields

          delegate: Item {
            id: fieldItem

            required property var modelData
            required property int index

            readonly property bool isCurrent: index === root.fieldIndex
            readonly property bool takesText: modelData.kind === "text" || modelData.kind === "image"
            readonly property bool inert: (modelData.underAll === true && root.form.unshareAll === true)
              || (modelData.key === "image" && root.form.clone !== "")
            readonly property string error: root.showError(modelData.key)
            readonly property string warning: root.check.warnings[modelData.key] || ""

            function takeFocus() { input.forceActiveFocus() }

            width: fieldsColumn.width
            implicitHeight: body.implicitHeight + px(Style.spacing.sm) * 2
            opacity: inert ? 0.45 : 1.0

            CursorSurface {
              anchors.fill: parent
              hasCursor: fieldItem.isCurrent
              foreground: root.foreground
            }

            MouseArea {
              anchors.fill: parent
              onClicked: {
                root.fieldIndex = fieldItem.index
                root.activate()
                Qt.callLater(root.focusCurrent)
              }
            }

            Column {
              id: body
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: px(Style.spacing.lg)
              anchors.rightMargin: px(Style.spacing.lg)
              spacing: px(Style.spacing.xs)

              // bool / section / clone: one line with a state glyph.
              Row {
                visible: !fieldItem.takesText
                width: parent.width
                spacing: px(Style.spacing.md)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: {
                    var f = fieldItem.modelData
                    if (f.kind === "section") return root.advanced ? "▾" : "▸"
                    if (f.kind === "clone") return "⧉"
                    if (f.kind === "template") return "≡"
                    return root.form[f.key] === true ? "■" : "□"
                  }
                  textFormat: Text.PlainText
                  color: fieldItem.modelData.kind === "bool" && root.form[fieldItem.modelData.key] === true
                    ? Color.accent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: root.fontLabel
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: {
                    var f = fieldItem.modelData
                    if (f.kind === "clone") return f.label + ":  " + (root.form.clone || "none")
                    if (f.kind === "template") return f.label + ":  " + root.templateLabel + (root.templateFilter !== "" ? "      filter: " + root.templateFilter : "")
                    if (f.kind === "section") return f.label + (root.advanced ? "" : "   hostname, clone, volumes, hooks, unshare…")
                    return f.label
                  }
                  textFormat: Text.PlainText
                  color: fieldItem.modelData.kind === "section" ? root.dim : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: root.fontRow
                  font.bold: fieldItem.modelData.kind === "section"
                  elide: Text.ElideRight
                  width: Math.min(implicitWidth, body.width - px(Style.space(24)))
                }
              }

              // text / image: a label over a field.
              Text {
                visible: fieldItem.takesText
                text: fieldItem.modelData.label
                textFormat: Text.PlainText
                color: fieldItem.isCurrent ? root.foreground : root.dim
                font.family: root.fontFamily
                font.pixelSize: root.fontRow
              }

              TextField {
                id: input
                visible: fieldItem.takesText
                width: parent.width
                enabled: !fieldItem.inert
                foreground: root.foreground
                font.family: root.fontFamily
                font.pixelSize: root.fontRow
                placeholderText: fieldItem.modelData.hint || ""
                // Bound, never assigned: the delegates outlive a close, and a
                // one-time copy of the text is what left last time's typing on
                // screen while the form's data had been reset (#4). Typing does
                // not break this binding (a JavaScript `text = …` would), and
                // textEdited fires only for typing, so there is no loop.
                text: fieldItem.takesText ? String(root.form[fieldItem.modelData.key] || "") : ""
                onTextEdited: {
                  root.imageIndex = -1
                  root.setValue(fieldItem.modelData.key, text)
                }
                onActiveFocusChanged: if (activeFocus && root.fieldIndex !== fieldItem.index) root.fieldIndex = fieldItem.index
                Keys.onPressed: function(event) {
                  if (root.navKey(event)) event.accepted = true
                }
              }

              // The templates, under "Start from", filtered by what was typed.
              Column {
                visible: fieldItem.modelData.kind === "template" && fieldItem.isCurrent
                width: parent.width
                spacing: 0

                Repeater {
                  model: fieldItem.modelData.kind === "template" ? root.templateChoices : []

                  delegate: Text {
                    required property var modelData
                    required property int index
                    width: parent ? parent.width : 0
                    text: (index === root.templateIndex ? "›  " : "   ") + modelData.label +
                      (modelData.source === "file" ? "  · yours" : "") +
                      (modelData.usable === false ? "  · can't use" : "") +
                      (modelData.tested ? "  · tested" : "") + (modelData.image ? "   " + modelData.image : "")
                    textFormat: Text.PlainText
                    opacity: modelData.usable === false ? 0.55 : 1.0
                    color: index === root.templateIndex ? Color.accent : root.dim
                    font.family: root.fontFamily
                    font.pixelSize: root.fontRow
                    elide: Text.ElideRight

                    MouseArea {
                      anchors.fill: parent
                      onClicked: root.pickTemplate(parent.index)
                    }
                  }
                }
              }

              // The curated images, filtered by what has been typed.
              Column {
                visible: fieldItem.modelData.kind === "image" && fieldItem.isCurrent && root.imageChoices.length > 0
                width: parent.width
                spacing: 0

                Repeater {
                  model: fieldItem.modelData.kind === "image" ? root.imageChoices : []

                  delegate: Text {
                    required property var modelData
                    required property int index
                    width: parent ? parent.width : 0
                    text: (index === root.imageIndex ? "›  " : "   ") + modelData.label + "   " + modelData.value
                    textFormat: Text.PlainText
                    color: index === root.imageIndex ? Color.accent : root.dim
                    font.family: root.fontFamily
                    font.pixelSize: root.fontRow
                    elide: Text.ElideRight

                    MouseArea {
                      anchors.fill: parent
                      onClicked: root.pickImage(parent.index)
                    }
                  }
                }
              }

              Text {
                visible: text !== ""
                width: parent.width
                text: fieldItem.modelData.kind === "template" && root.templateNotice !== "" ? root.templateNotice
                  : fieldItem.error !== "" ? fieldItem.error
                  : (fieldItem.warning !== "" ? fieldItem.warning
                  : (fieldItem.isCurrent && !fieldItem.takesText && fieldItem.modelData.hint ? fieldItem.modelData.hint : ""))
                textFormat: Text.PlainText
                color: fieldItem.error !== "" || (fieldItem.modelData.kind === "template" && root.templateNotice !== "")
                  ? Color.urgent : root.dim
                font.family: root.fontFamily
                font.pixelSize: root.fontRow
                wrapMode: Text.WordWrap
              }
            }
          }
        }
      }
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignRight
      text: {
        var f = root.current
        var move = "tab/↓ next   "
        if (!f) return ""
        if (f.kind === "image") return (root.imageIndex >= 0 ? "enter pick   " : "↓ list   ") + "tab next   esc cancel"
        if (f.kind === "template") return (root.templateIndex >= 0 ? "enter pick   " : "↓ list   ") + "type to filter   tab next   esc cancel"
        if (f.kind === "bool") return move + "space toggle   enter create   esc cancel"
        if (f.kind === "section") return move + "space " + (root.advanced ? "hide" : "show") + "   esc cancel"
        if (f.kind === "clone") return move + "space next box   enter create   esc cancel"
        return move + "enter create   esc cancel"
      }
      textFormat: Text.PlainText
      color: root.foreground
      opacity: 0.65
      font.family: root.fontFamily
      font.pixelSize: root.fontRow
    }
  }
}
