// Utils only used in the extension. Do not import this file in the preferences window because Shell is not available there.

import GLib from "gi://GLib";
import Soup from "gi://Soup";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import { debugLog, errorLog } from "./common.js";

Gio._promisify(Gio.DBusProxy, "new", "new_finish");
Gio._promisify(Gio.File.prototype, "replace_contents_bytes_async", "replace_contents_finish");
Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.File.prototype, "enumerate_children_async", "enumerate_children_finish");
Gio._promisify(Gio.FileEnumerator.prototype, "next_files_async", "next_files_finish");
Gio._promisify(Gio.Subprocess.prototype, "communicate_async", "communicate_finish");
Gio._promisify(Gio.DBusConnection.prototype, "call", "call_finish");

/** Artwork Chromium writes in the snap's private /tmp, out of reach from the shell. */
const CHROMIUM_SNAP_ART = /^file:\/\/\/tmp\/(\.org\.chromium\.Chromium\.[A-Za-z0-9_]+)$/;
const MAX_SNAP_ART_BYTES = 5 * 1024 * 1024;
const SNAP_ART_TIMEOUT_SECONDS = 5;

/**
 * Reads Chromium's artwork from inside its snap, where its /tmp is visible.
 * @param {string} url
 * @returns {Promise<Gio.InputStream | null>}
 */
export const getChromiumSnapImage = async (url) => {
    const name = url?.match(CHROMIUM_SNAP_ART)?.[1];
    if (name == null || GLib.file_test("/snap/bin/chromium", GLib.FileTest.EXISTS) === false) {
        return null;
    }
    try {
        // The path is passed as an argument, never interpolated in the script. head stops one
        // byte past the limit, so a larger file is read no further and then rejected.
        const process = Gio.Subprocess.new(
            ["snap", "run", "--shell", "chromium", "-c", `exec head -c ${MAX_SNAP_ART_BYTES + 1} -- "$0"`, `/tmp/${name}`],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        );
        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SNAP_ART_TIMEOUT_SECONDS, () => {
            timeoutId = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        /** @type {[GLib.Bytes | null, GLib.Bytes | null]} */
        const [stdout] = await /** @type {any} */ (process.communicate_async(null, null)).finally(() => {
            if (timeoutId !== 0) {
                GLib.source_remove(timeoutId);
            }
        });
        if (process.get_successful() === false || stdout == null) {
            return null;
        }
        const size = stdout.get_size();
        if (size === 0 || size > MAX_SNAP_ART_BYTES) {
            return null;
        }
        return Gio.MemoryInputStream.new_from_bytes(stdout);
    } catch (error) {
        errorLog("Failed to read Chromium artwork:", error);
        return null;
    }
};

// TODO: sort this out

/**
 * @param {string} id
 * @param {string} entry
 * @returns {Gio.AppInfo | null}
 */
export const getAppInfoByIdAndEntry = (id, entry) => {
    const apps = Gio.AppInfo.get_all();
    for (const app of apps) {
        if (
            app.get_display_name() === entry ||
            app.get_id() === id ||
            app.get_name() === entry ||
            app.get_name() === id
        ) {
            return app;
        }
    }
    return null;
};

/**
 * @param {string} id
 * @param {string} entry
 * @returns {Shell.App | null}
 */
export const getAppByIdAndEntry = (id, entry) => {
    const appSystem = Shell.AppSystem.get_default();
    const runningApps = appSystem.get_running();
    const idResults = Shell.AppSystem.search(id ?? "");
    const entryResults = Shell.AppSystem.search(entry ?? "");

    // Try to find in running apps first
    if (entryResults?.length > 0) {
        const app = runningApps.find((app) => entryResults[0].includes(app.get_id()));
        if (app != null) {
            return app;
        }
    }
    if (idResults?.length > 0) {
        const app = runningApps.find((app) => idResults[0].includes(app.get_id()));
        if (app != null) {
            return app;
        }
    }

    // If not found in running apps, try to lookup by desktop file ID
    if (entry) {
        // Try with .desktop extension
        let app = appSystem.lookup_app(`${entry}.desktop`);
        if (app != null) {
            return app;
        }
        // Try without extension in case it already has it
        app = appSystem.lookup_app(entry);
        if (app != null) {
            return app;
        }
    }

    if (id) {
        // Try with .desktop extension
        let app = appSystem.lookup_app(`${id}.desktop`);
        if (app != null) {
            return app;
        }
        // Try without extension
        app = appSystem.lookup_app(id);
        if (app != null) {
            return app;
        }
    }

    return null;
};

const artCacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), "mediacontrols@cliffniff.github.com"]);
const ART_CACHE_MAX_AGE_SECONDS = 60 * 24 * 3600;
const MAX_ART_BYTES = 10 * 1024 * 1024;

/** @type {Soup.Session | null} */
let imageSession = null;

/**
 * @param {string} busName
 * @returns {Promise<number | null>}
 */
export const getBusNamePid = async (busName) => {
    try {
        const reply = await Gio.DBus.session.call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "GetConnectionUnixProcessID",
            new GLib.Variant("(s)", [busName]),
            new GLib.VariantType("(u)"),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
        );
        return reply.deepUnpack()[0];
    } catch {
        return null;
    }
};

/**
 * Application owning the windows of a process. Matching by process is reliable where
 * MPRIS names are not ("firefox-dev" for firefox-devedition.desktop).
 * @param {number | null} pid
 * @returns {Shell.App | null}
 */
export const getAppByPid = (pid) => {
    if (pid == null) {
        return null;
    }
    const app = Shell.WindowTracker.get_default().get_app_from_pid(pid);
    // Apps made up from a window have no desktop file, nor a proper name or icon.
    return app?.get_app_info() != null ? app : null;
};

/**
 * @param {string} url
 * @param {boolean} [cache] Keep downloaded images on disk
 * @returns {Promise<Gio.InputStream | null>}
 */
export const getImage = async (url, cache = true) => {
    if (url == null || url === "") {
        return null;
    }
    let uri;
    try {
        uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    } catch {
        return null;
    }
    const scheme = uri.get_scheme();
    if (scheme === "file") {
        const file = Gio.File.new_for_uri(uri.to_string());
        if (file.query_exists(null) === false) {
            return null;
        }
        return await file.read_async(GLib.PRIORITY_DEFAULT, null).catch(() => null);
    }
    if (scheme !== "http" && scheme !== "https") {
        debugLog(`Invalid scheme: ${scheme}`);
        return null;
    }

    // A hash keeps names short and free of "/", unlike the URL itself.
    const file = Gio.File.new_for_path(
        GLib.build_filenamev([artCacheDir, GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1)]),
    );
    if (cache && file.query_exists(null)) {
        try {
            // Marks the cover as used, see pruneArtCache.
            file.set_attribute_uint64(
                Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
                Math.floor(GLib.get_real_time() / 1e6),
                Gio.FileQueryInfoFlags.NONE,
                null,
            );
        } catch {
            // Read-only cache: the cover is just pruned earlier.
        }
        return await file.read_async(GLib.PRIORITY_DEFAULT, null).catch(() => null);
    }
    const bytes = await download(uri);
    if (bytes == null) {
        return null;
    }
    if (cache) {
        GLib.mkdir_with_parents(artCacheDir, 0o755);
        // @ts-expect-error Types are wrong
        await file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null).catch(errorLog);
    }
    return Gio.MemoryInputStream.new_from_bytes(bytes);
};

/**
 * @param {GLib.Uri} uri
 * @returns {Promise<GLib.Bytes | null>}
 */
const download = async (uri) => {
    imageSession ??= new Soup.Session({ timeout: 15 });
    const message = new Soup.Message({ method: "GET", uri });
    try {
        /** @type {Gio.InputStream} */
        const stream = await /** @type {any} */ (imageSession.send_async(message, GLib.PRIORITY_LOW, null));
        if (message.get_status() !== Soup.Status.OK) {
            debugLog(`Image not available (${message.get_status()}): ${uri.to_string()}`);
            stream.close_async(GLib.PRIORITY_LOW, null, null);
            return null;
        }
        const chunks = [];
        let size = 0;
        while (size <= MAX_ART_BYTES) {
            /** @type {GLib.Bytes} */
            const chunk = await /** @type {any} */ (stream.read_bytes_async(65536, GLib.PRIORITY_LOW, null));
            if (chunk.get_size() === 0) {
                break;
            }
            chunks.push(chunk.toArray());
            size += chunk.get_size();
        }
        stream.close_async(GLib.PRIORITY_LOW, null, null);
        if (size === 0 || size > MAX_ART_BYTES) {
            return null;
        }
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return GLib.Bytes.new(data);
    } catch (error) {
        debugLog(`Failed to load image ${uri.to_string()}:`, error);
        return null;
    }
};

/**
 * Removes covers unused for two months, and the cover files a crashed shell left behind.
 * Covers are touched when read from the cache, so the files still in use stay.
 * @returns {Promise<void>}
 */
export const pruneArtCache = async () => {
    const now = GLib.get_real_time() / 1e6;
    const prune = async (/** @type {string} */ dir, /** @type {number} */ maxAge) => {
        const directory = Gio.File.new_for_path(dir);
        /** @type {Gio.FileEnumerator} */
        const enumerator = await /** @type {any} */ (
            directory.enumerate_children_async(
                "standard::name,standard::type,time::modified",
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_LOW,
                null,
            )
        ).catch(() => null);
        if (enumerator == null) {
            return;
        }
        for (;;) {
            /** @type {Gio.FileInfo[]} */
            const infos = await /** @type {any} */ (enumerator.next_files_async(100, GLib.PRIORITY_LOW, null));
            if (infos.length === 0) {
                break;
            }
            for (const info of infos) {
                const age = now - info.get_attribute_uint64("time::modified");
                if (info.get_file_type() === Gio.FileType.REGULAR && age > maxAge) {
                    directory.get_child(info.get_name()).delete_async(GLib.PRIORITY_LOW, null, null);
                }
            }
        }
    };
    await prune(artCacheDir, ART_CACHE_MAX_AGE_SECONDS);
    // Favicons used to be kept there, one file per site played: a browsing history.
    await prune(GLib.build_filenamev([artCacheDir, "sites"]), 0);
    Gio.File.new_for_path(GLib.build_filenamev([artCacheDir, "sites"])).delete_async(GLib.PRIORITY_LOW, null, null);
    // A minute of margin: the cover being shown is written when the first player appears.
    await prune(GLib.build_filenamev([GLib.get_user_runtime_dir(), "mediacontrols"]), 60);
};

/**
 * @template T
 * @param {Gio.DBusInterfaceInfo} ifaceInfo
 * @param {string} name
 * @param {string} object
 * @returns {Promise<T>}
 */
export const createDbusProxy = async (ifaceInfo, name, object) => {
    // @ts-expect-error Types have not been promisified yet
    const proxy = Gio.DBusProxy.new(
        Gio.DBus.session,
        Gio.DBusProxyFlags.NONE,
        ifaceInfo,
        name,
        object,
        ifaceInfo.name,
        null,
    );
    return proxy;
};
