// Decoding of images coming from websites and players.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");

/**
 * A small file can declare huge dimensions and make the shell allocate gigabytes:
 * images are refused past this many pixels (4096 x 4096), before being decoded.
 */
const MAX_PIXELS = 4096 * 4096;
const CHUNK_BYTES = 4096;

/**
 * @param {GLib.Bytes} bytes
 * @param {number} [minSide] Scalable images (SVG) smaller than this are rendered larger
 * @returns {GdkPixbuf.Pixbuf | null}
 */
export const decodeImage = (bytes, minSide = 0) => {
    let refused = false;
    const loader = new GdkPixbuf.PixbufLoader();
    loader.connect("size-prepared", (_, width, height) => {
        if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
            refused = true;
            // A zero size makes the loaders stop before allocating anything.
            loader.set_size(0, 0);
            return;
        }
        const side = Math.max(width, height);
        if (side < minSide) {
            loader.set_size(Math.round((width * minSide) / side), Math.round((height * minSide) / side));
        }
    });
    try {
        // Fed in small pieces: the header comes first, so a refused image stops before
        // the decoder gets the rest of the data and allocates for it.
        const data = bytes.toArray();
        for (let offset = 0; offset < data.length && refused === false; offset += CHUNK_BYTES) {
            loader.write(data.subarray(offset, offset + CHUNK_BYTES));
        }
        loader.close();
    } catch {
        try {
            loader.close();
        } catch {
            // Already closed by the failed write.
        }
        return null;
    }
    return refused ? null : loader.get_pixbuf();
};

/**
 * @param {Gio.InputStream} stream
 * @param {number} maxBytes
 * @returns {Promise<GLib.Bytes | null>} null when the stream holds more than maxBytes
 */
export const readStream = async (stream, maxBytes) => {
    const chunks = [];
    let size = 0;
    try {
        while (size <= maxBytes) {
            /** @type {GLib.Bytes} */
            const chunk = await /** @type {any} */ (stream.read_bytes_async(65536, GLib.PRIORITY_LOW, null));
            if (chunk.get_size() === 0) {
                break;
            }
            chunks.push(chunk.toArray());
            size += chunk.get_size();
        }
    } catch {
        return null;
    } finally {
        stream.close_async(GLib.PRIORITY_LOW, null, null);
    }
    if (size > maxBytes) {
        return null;
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
    }
    return GLib.Bytes.new(data);
};
