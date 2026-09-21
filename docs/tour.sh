#!/usr/bin/env bash
# The scripted tour behind docs/img/rec-tour.* (and the three clips cut from
# it). Run it through `docs/capture.sh --tour OUT.mp4`, after
# `docs/capture.sh --setup`, on an empty workspace with do-not-disturb on.
#
# wtype types into whatever has focus, so every key checks first that a
# plugin layer is up and stops the tour if not. The cursor is put on a box
# by filtering to its name and pressing Down, never by counting rows.
set -u

up() { hyprctl layers -j | grep -q -E '"(omarchy-keyboard-panel|nixarchy-distrobox-menu)"'; }
k() { up || { echo "tour: no plugin layer before: $*" >&2; exit 3; }; wtype "$@"; }
t() { k -d 110 "$1"; }
p() { sleep "${1:-1}"; }
idle() {
  for _ in $(seq 180); do
    [ "$(omarchy-shell nixarchy.distrobox.bar status | jq -r .mutating)" = false ] && return
    sleep 1
  done
}
sel() { k /; p 0.3; k -M ctrl a -m ctrl; t "$1"; p 0.6; k -k Down; p 0.8; }
unfilter() { k /; p 0.3; k -k Escape; p 0.3; k -k Escape; p 0.6; }

# ---- the full-screen menu
omarchy-shell shell toggle nixarchy.distrobox '{}'; p 2.5
k j; p 0.7; k j; p 0.7; k j; p 0.7; k k; p 0.7; k k; p 1       # move
k /; p 0.4; t demo; p 1.8; k -k Escape; p 0.5; k -k Escape; p 1 # filter
k '?'; p 3.5; k '?'; p 1                                        # shortcut sheet
sel demo-fedora; k p; p 4; k -k Escape; p 1                     # promote
k c; p 1.2; t demo-new; p 0.6; k -k Tab; p 0.6; k -k Down; p 1.2
t ubu; p 1.2; k -k Return; p 2; k -k Tab; p 0.4; k -k Tab; p 0.6
k -k Return; p 1; idle; p 3; k -k Escape; p 1.5                # create, streamed
sel demo-new; k s; p 1.5; idle; p 2                             # first start runs setup
sel demo-fedora; k g; p 1; idle; p 3; k -k Escape; p 1.5        # upgrade, streamed
sel demo-broken; k x; p 2.5; k -k Escape; p 1                   # delete question, cancel
unfilter; k S; p 2.5; k -k Escape; p 1                          # stop-all question, cancel
k -k Escape; p 1.5                                              # close

# ---- the bar popup, same state
omarchy shell nixarchy.distrobox.bar open; p 2.5
k j; p 0.7; k j; p 0.7; k '?'; p 2.5; k '?'; p 1
k -k Escape; p 1.5
