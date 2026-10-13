#!/usr/bin/env bash
# Arrête la session imbriquée, les faux lecteurs et le Firefox de test.
T="$XDG_RUNTIME_DIR/mediacontrols-nested"
pkill -f -- "--profile $T/ff-profile"
pkill -f "gjs -m .*fake-player\.js"
pkill -f '^gnome-shell --devkit'
pkill -x mutter-devkit
sleep 2
