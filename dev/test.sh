#!/usr/bin/env bash
# Relance la session imbriquée avec la version courante, deux faux lecteurs, et capture le popup
# pour chacun : test.sh <dossier de sortie>
set -uo pipefail
DEV="$(cd "$(dirname "$0")" && pwd)"
T="${XDG_RUNTIME_DIR}/mediacontrols-nested"
OUT="${1:-$T/shots}"
pkill -f '^gnome-shell --devkit' ; pkill -x mutter-devkit; pkill -f "$DEV/fake-player.js"; sleep 1
setsid "$DEV/nested.sh" > "$T.log" 2>&1 < /dev/null &
for _ in $(seq 30); do sleep 0.5; [ -s "$T/bus" ] && break; done; sleep 6
export DBUS_SESSION_BUS_ADDRESS="$(cat "$T/bus")"
mkdir -p "$OUT"
cp "$HOME/.config/mozilla/firefox/firefox-mpris/"*.png "$T/yt-small.png" 2>/dev/null
setsid gjs -m "$DEV/fake-player.js" spotify Spotify spotify "The Emptiness Machine" "Linkin Park" \
  "https://i.scdn.co/image/ab67616d0000b27385091942613ffa9be596af76" "https://open.spotify.com/track/3AA50LilsWIK5HstsdUa0I" >/dev/null 2>&1 < /dev/null &
sleep 2
setsid gjs -m "$DEV/fake-player.js" firefox.instance_1 "Mozilla firefox-dev" firefox-dev "Une game incroyable, jusqu'à... - Lycans" \
  "Ponce Replay" "file://$T/yt-small.png" "https://www.youtube.com/watch?v=8Nvq2NZoFMI&t=328s" >/dev/null 2>&1 < /dev/null &
sleep 3
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"; }
B='Object.values(Main.panel.statusArea).find(x => x.constructor.$gtype?.name === "PanelButton")'
# voir shot.sh pour une capture isolée
shoot() {
  ev "$B.menu.open(false); 1" >/dev/null; sleep 1.5
  gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$T/full.png" >/dev/null
  local geom; geom=$(ev "const a = $B.menu.actor; const s = global.stage.width; JSON.stringify([a.x, a.y, a.width, a.height, s])" | grep -o '\[[^]]*\]' | tr -d '\\"[]')
  python3 -c "
from PIL import Image; import sys
x,y,w,h,s=map(float,'$geom'.split(',')); im=Image.open('$T/full.png'); k=im.width/s
im.crop((int((x-20)*k),0,int((x+w+20)*k),int((y+h+20)*k))).save('$OUT/$1.png')"
  ev "$B.menu.close(false); 1" >/dev/null
}
shoot youtube
# Onglet Spotify
ev "const b = $B; b.updateProxy(Main.panel.statusArea && global._mcp || b.extension.getPlayers().find(p => p.busName.includes('spotify'))); 1" >/dev/null
shoot spotify
grep -iE 'critical|error.*media controls|JS ERROR' "$T.log" | head -5
echo "$OUT"
