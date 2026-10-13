#!/usr/bin/env bash
# Capture tout l'écran de la session imbriquée en coordonnées logiques : look.sh <fichier.png>
T="$XDG_RUNTIME_DIR/mediacontrols-nested"
export DBUS_SESSION_BUS_ADDRESS="$(cat "$T/bus")"
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$T/look-full.png" >/dev/null
python3 -c "
from PIL import Image; im=Image.open('$T/look-full.png'); im.resize((1280, round(im.height*1280/im.width))).save('$1')"
