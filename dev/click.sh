#!/usr/bin/env bash
# Clic gauche virtuel dans la session imbriquée, en coordonnées de l'écran : click.sh <x> <y>
export DBUS_SESSION_BUS_ADDRESS="$(cat "$XDG_RUNTIME_DIR/mediacontrols-nested/bus")"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "
const { Clutter, GLib } = imports.gi;
global._mcPointer ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
const p = global._mcPointer, t = GLib.get_monotonic_time();
p.notify_absolute_motion(t, $1, $2);
p.notify_button(t + 50000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
p.notify_button(t + 100000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
global.stage.width"
