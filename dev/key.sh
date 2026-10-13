#!/usr/bin/env bash
# Touche virtuelle dans la session imbriquée : key.sh <nom de touche Clutter, ex. m, space>
export DBUS_SESSION_BUS_ADDRESS="$(cat "$XDG_RUNTIME_DIR/mediacontrols-nested/bus")"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "
const { Clutter, GLib } = imports.gi;
global._mcKeyboard ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
const k = global._mcKeyboard, t = GLib.get_monotonic_time();
k.notify_keyval(t, Clutter.KEY_$1, Clutter.KeyState.PRESSED);
k.notify_keyval(t + 50000, Clutter.KEY_$1, Clutter.KeyState.RELEASED);
1"
