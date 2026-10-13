// Icons bundled with the extension (Material Symbols Rounded and Simple Icons). Shell only.

import Gio from "gi://Gio";
import GLib from "gi://GLib";

const iconsDir = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0])),
    "icons",
]);

/**
 * Symbolic icons are recolored by the theme, like the stock ones.
 * @param {string} name
 * @param {boolean} [symbolic]
 * @returns {Gio.Icon}
 */
export const getBundledIcon = (name, symbolic = true) => {
    const suffix = symbolic ? "-symbolic" : "";
    return Gio.FileIcon.new(Gio.File.new_for_path(GLib.build_filenamev([iconsDir, `mc-${name}${suffix}.svg`])));
};
