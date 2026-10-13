#!/usr/bin/env bash
# État des lecteurs de la session imbriquée et des flux audio du Firefox de test.
T="$XDG_RUNTIME_DIR/mediacontrols-nested"
export DBUS_SESSION_BUS_ADDRESS="$(cat "$T/bus")"
for p in $(busctl --user list --no-legend | awk '{print $1}' | grep '^org.mpris'); do
  echo "  $p $(gdbus call --session --dest "$p" --object-path /org/mpris/MediaPlayer2 --method org.freedesktop.DBus.Properties.Get org.mpris.MediaPlayer2.Player PlaybackStatus)"
done
echo "  bouton: $(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '!!Object.values(Main.panel.statusArea).find(x => x.constructor.$gtype?.name === "PanelButton")')"
pactl -f json list sink-inputs 2>/dev/null | python3 -c "
import json,sys
for s in json.load(sys.stdin):
  p=s['properties']
  if 'Firefox' in p.get('application.name',''): print('  flux', p.get('application.process.id'), 'muet' if s['mute'] else 'son', 'corked' if s.get('corked') else 'actif', p.get('media.name','')[:50])"
