#!/usr/bin/env bash
# Stages throwaway distrobox boxes for the showcase captures in docs/img, and
# removes them again. Run it on the desktop the captures are taken on.
#
#   docs/capture.sh --setup      create the demo boxes (refuses if any exist)
#   docs/capture.sh --teardown   remove exactly what --setup created, and put
#                                back shell.json and omarchy-menu.jsonc
#   docs/capture.sh --shot NAME X,Y WxH
#                                crop one still into docs/img/NAME.png
#
# The owner's boxes are never touched: --setup refuses to run if any name it
# would use already exists, records every box and home it creates, and
# --teardown removes only what that record lists. Every demo box gets its own
# home under ~/.local/share/distrobox/, so the first-run setup never writes
# into the owner's home directory.
#
# It also saves shell.json and the Omarchy menu extension file before anything
# is changed (settings shots, the menu-row shot) and restores both on
# teardown, byte for byte, symlink or not (cp -a).
#
# Surfaces are opened with the shell's IPC, and a shot is taken only once the
# surface's layer is up (hyprctl layers). Key-driven states and the
# recordings need key input; AGENTS.md describes that part.
set -euo pipefail

img_dir="$(cd "$(dirname "$0")" && pwd)/img"
fedora=registry.fedoraproject.org/fedora-toolbox:latest
ubuntu=quay.io/toolbx/ubuntu-toolbox:24.04
homes="$HOME/.local/share/distrobox"
boxes=(demo-fedora demo-ubuntu demo-broken)
saved=("$HOME/.config/omarchy/shell.json" "$HOME/.config/omarchy/extensions/omarchy-menu.jsonc")
run_dir="${XDG_RUNTIME_DIR:-/tmp}/nixarchy-distrobox-capture"
# One line per created thing, "kind name", read back by --teardown.
state="$run_dir/state"

made() { echo "$1 $2" >>"$state"; }

dbx() { env DBX_CONTAINER_MANAGER=podman distrobox "$@"; }

refuse_collisions() {
  local b clash=0
  for b in "${boxes[@]}"; do
    if podman container exists "$b"; then echo "exists: box $b" >&2; clash=1; fi
    if [ -e "$homes/$b" ]; then echo "exists: $homes/$b" >&2; clash=1; fi
  done
  if [ -s "$state" ]; then echo "exists: $state (run --teardown first)" >&2; clash=1; fi
  if [ "$clash" -ne 0 ]; then
    echo "refusing: these names belong to something that is not this script's" >&2
    exit 1
  fi
}

create() { # create <name> <image> [extra distrobox create flags...]
  local name=$1 image=$2
  shift 2
  dbx create --yes --name "$name" --image "$image" --home "$homes/$name" "$@" >/dev/null
  made box "$name"
  made home "$homes/$name"
}

setup() {
  mkdir -p "$run_dir"
  refuse_collisions
  : >"$state"
  local f i=0
  for f in "${saved[@]}"; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      cp -a "$f" "$run_dir/saved.$i"
      made saved "$i $f"
    fi
    i=$((i + 1))
  done

  # A running box: its first start runs distrobox's own setup.
  create demo-fedora "$fedora"
  dbx enter --name demo-fedora -T -- true </dev/null >/dev/null 2>&1
  # A created box that has never been started.
  create demo-ubuntu "$ubuntu"
  # A box that really fails: --init on an image without systemd, the same
  # "no init found" a user gets. The red row is real, not staged.
  create demo-broken "$fedora" --init
  dbx enter --name demo-broken -T -- true </dev/null >/dev/null 2>&1 || true
}

teardown() {
  [ -f "$state" ] || { echo "nothing recorded; nothing to remove"; return; }
  local kind rest
  while read -r kind rest; do
    [ "$kind" = box ] || continue
    dbx rm --force "$rest" >/dev/null 2>&1 || true
  done <"$state"
  while read -r kind rest; do
    [ "$kind" = home ] || continue
    # Only a path this script created, under the distrobox homes directory.
    case $rest in "$homes"/demo-*) rm -rf -- "$rest" ;; esac
  done <"$state"
  while read -r kind rest; do
    [ "$kind" = saved ] || continue
    local i=${rest%% *} f=${rest#* }
    rm -f -- "$f"
    cp -a "$run_dir/saved.$i" "$f"
  done <"$state"
  rm -rf -- "$run_dir"
}

shot() {
  local name=$1 pos=$2 size=$3
  mkdir -p "$img_dir"
  grim -g "$pos $size" "$img_dir/$name.png"
  echo "  $name.png ($size at $pos)"
}

case "${1:-}" in
  --setup) setup ;;
  --teardown) teardown ;;
  --shot) shift; shot "$@" ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac
