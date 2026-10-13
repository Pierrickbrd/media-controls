// Which processes are making sound, to leave muted players out. Shell only.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Volume from "resource:///org/gnome/shell/ui/status/volume.js";
import { debugLog } from "./common.js";

Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish");

/** Mixer events come in bursts: one refresh per burst. */
const REFRESH_DELAY_MS = 250;

export default class AudioStreams {
    /**
     * @private
     * @type {Map<number, boolean>} process id -> whether one of its streams is audible
     */
    streams = new Map();
    /**
     * Processes that had a stream: proves that their id matches the one PipeWire sees,
     * which is not the case in a Flatpak sandbox.
     * @private
     * @type {Set<number>}
     */
    seen = new Set();
    /**
     * @private
     * @type {number[]}
     */
    signalIds = [];
    /**
     * @private
     * @type {number}
     */
    refreshSourceId = 0;
    /**
     * @private
     * @type {boolean}
     */
    available = GLib.find_program_in_path("pactl") != null;

    /**
     * @param {() => void} onChange
     */
    constructor(onChange) {
        this.onChange = onChange;
        this.control = Volume.getMixerControl();
        for (const signal of ["stream-added", "stream-removed", "stream-changed"]) {
            this.signalIds.push(this.control.connect(signal, () => this.scheduleRefresh()));
        }
        this.scheduleRefresh();
    }

    /**
     * @public
     * @returns {void}
     */
    scheduleRefresh() {
        if (this.available === false || this.refreshSourceId !== 0) {
            return;
        }
        this.refreshSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY_MS, () => {
            this.refreshSourceId = 0;
            this.refresh().catch((error) => debugLog("Failed to list audio streams:", error));
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * @public
     * @param {number | null} pid
     * @returns {boolean | null} null when the process has no stream
     */
    isAudible(pid) {
        return pid == null ? null : (this.streams.get(pid) ?? null);
    }

    /**
     * @public
     * @param {number | null} pid
     * @returns {boolean}
     */
    hasBeenSeen(pid) {
        return pid != null && this.seen.has(pid);
    }

    /**
     * @public
     * @returns {boolean}
     */
    isAvailable() {
        return this.available;
    }

    /**
     * @private
     * @returns {Promise<void>}
     */
    async refresh() {
        const process = Gio.Subprocess.new(
            ["pactl", "--format=json", "list", "sink-inputs"],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        );
        /** @type {[string | null, string | null]} */
        const [stdout] = await /** @type {any} */ (process.communicate_utf8_async(null, null));
        if (process.get_successful() === false || stdout == null || this.control == null) {
            return;
        }
        /** @type {Map<number, boolean>} */
        const streams = new Map();
        for (const stream of JSON.parse(stdout)) {
            const pid = Number(stream.properties?.["application.process.id"]);
            if (Number.isInteger(pid) === false || pid <= 0) {
                continue;
            }
            const volumes = Object.values(stream.volume ?? {}).map((channel) => Number(channel.value) || 0);
            const audible = stream.mute !== true && stream.corked !== true && volumes.some((value) => value > 0);
            streams.set(pid, (streams.get(pid) ?? false) || audible);
            this.seen.add(pid);
        }
        const changed =
            streams.size !== this.streams.size ||
            [...streams].some(([pid, audible]) => this.streams.get(pid) !== audible);
        this.streams = streams;
        if (changed) {
            this.onChange();
        }
    }

    /**
     * @public
     * @returns {void}
     */
    destroy() {
        if (this.refreshSourceId !== 0) {
            GLib.source_remove(this.refreshSourceId);
            this.refreshSourceId = 0;
        }
        for (const id of this.signalIds) {
            this.control?.disconnect(id);
        }
        this.signalIds = [];
        this.control = null;
    }
}
