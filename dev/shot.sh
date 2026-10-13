#!/usr/bin/env bash
# Ouvre le popup de l'extension dans la session imbriquée et capture la zone : shot.sh <fichier.png>
set -euo pipefail
T="${XDG_RUNTIME_DIR}/mediacontrols-nested"
export DBUS_SESSION_BUS_ADDRESS="$(cat "$T/bus")"
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"; }
B='Object.values(Main.panel.statusArea).find(x => x.constructor.$gtype?.name === "PanelButton")'
ev "$B.menu.open(false); 1" >/dev/null; sleep 2
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$T/full.png" >/dev/null
geom=$(ev "const a = $B.menu.actor; const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); JSON.stringify([x, y, w, h, global.stage.width])" | grep -o '\[[^]]*\]' | tr -d '\\"[]')
ev "$B.menu.close(false); 1" >/dev/null
python3 -c "
from PIL import Image
x,y,w,h,s=map(float,'$geom'.split(',')); im=Image.open('$T/full.png'); k=im.width/s
im.crop((max(0,int((x-20)*k)),0,int((x+w+20)*k),int((y+h+20)*k))).save('$1')"
