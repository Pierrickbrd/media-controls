#!/usr/bin/env bash
# Lance une session GNOME Shell imbriquée isolée (données, réglages et cache à part) avec la
# version de développement de l'extension et un faux lecteur. L'adresse du bus D-Bus de la
# session est écrite dans $T/bus pour piloter la session depuis l'extérieur.
set -euo pipefail
DEV="$(cd "$(dirname "$0")" && pwd)"
T="${NESTED_DIR:-${XDG_RUNTIME_DIR}/mediacontrols-nested}"
UUID=mediacontrols@cliffniff.github.com
rm -rf "$T" && mkdir -p "$T"/{data/gnome-shell/extensions,config,cache,state}
for d in themes icons fonts; do [ -e "$HOME/.local/share/$d" ] && ln -s "$HOME/.local/share/$d" "$T/data/$d"; done
ZIP="$("$DEV/build.sh" | tail -1)"
unzip -q "$ZIP" -d "$T/data/gnome-shell/extensions/$UUID"
glib-compile-schemas "$T/data/gnome-shell/extensions/$UUID/schemas"
# Extension de test : mode non sûr pour autoriser Eval et Screenshot sur le bus imbriqué.
U="$T/data/gnome-shell/extensions/unsafe@dev"; mkdir -p "$U"
echo '{"uuid":"unsafe@dev","name":"unsafe","description":"test","shell-version":["50"]}' > "$U/metadata.json"
echo 'export default class { enable() { global.context.unsafe_mode = true; } disable() {} }' > "$U/extension.js"
dconf dump /org/gnome/shell/extensions/mediacontrols/ > "$T/mediacontrols.ini"
export XDG_DATA_HOME="$T/data" XDG_CONFIG_HOME="$T/config" XDG_CACHE_HOME="$T/cache" XDG_STATE_HOME="$T/state"
exec dbus-run-session -- bash -c '
  dconf write /org/gnome/shell/enabled-extensions "[\"unsafe@dev\", \"user-theme@gnome-shell-extensions.gcampax.github.com\", \"'$UUID'\"]"
  dconf write /org/gnome/shell/disable-user-extensions false
  dconf load /org/gnome/shell/extensions/mediacontrols/ < "'$T'/mediacontrols.ini"
  [ -n "${NESTED_DCONF:-}" ] && eval "$NESTED_DCONF"
  dconf write /org/gnome/shell/extensions/user-theme/name "\"Pierrick\""
  dconf write /org/gnome/desktop/interface/color-scheme "\"prefer-dark\""
  dconf write /org/gnome/desktop/interface/accent-color "\"blue\""
  echo "$DBUS_SESSION_BUS_ADDRESS" > "'$T'/bus"
  MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x1000 exec gnome-shell --devkit --wayland
'
