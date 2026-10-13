#!/usr/bin/env bash
# Construit le zip de l'extension (mêmes étapes que « pnpm run build », sans pnpm).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/temp dist/builds
cp -r src/* dist/temp/
glib-compile-resources assets/org.gnome.shell.extensions.mediacontrols.gresource.xml \
  --target=dist/temp/org.gnome.shell.extensions.mediacontrols.gresource --sourcedir=assets
cd dist/temp
gnome-extensions pack -f -o ../builds/ \
  --schema='../../assets/org.gnome.shell.extensions.mediacontrols.gschema.xml' --podir='../../assets/locale' \
  --extra-source=helpers --extra-source=types --extra-source=utils --extra-source=icons \
  --extra-source=org.gnome.shell.extensions.mediacontrols.gresource .
echo "$PWD/../builds/mediacontrols@cliffniff.github.com.shell-extension.zip"
