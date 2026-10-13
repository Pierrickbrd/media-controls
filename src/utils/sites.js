// Website a browser player is playing from: its favicon and name, fetched from the site itself. Shell only.

/** @import PlayerProxy from '../helpers/shell/PlayerProxy.js' */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Shell from "gi://Shell";
import Soup from "gi://Soup";
import { debugLog, errorLog } from "./common.js";
import { decodeImage } from "./images.js";

Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(Gio.Resolver.prototype, "lookup_by_name_async", "lookup_by_name_finish");
Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");

/**
 * @typedef {Object} Site
 * @property {Gio.Icon} gicon
 * @property {string} name
 */

const BROWSER = /firefox|librewolf|waterfox|floorp|zen|chrom|brave|vivaldi|edge|opera|epiphany|falkon/i;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** Large enough for the cover placeholder, the panel shows it at 16 px. */
const ICON_SIZE = 128;
/** Icons are declared in the <head>, no need for the rest of the page. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
/** A page could declare thousands of icons: only the best few are tried. */
const MAX_ICON_CANDIDATES = 6;
const MAX_NAME_LENGTH = 60;
/** A site that failed (network down, no icon) is tried again after this delay. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/** @type {Map<string, Site | null>} host -> site, null when the site has no usable icon */
const sites = new Map();
/** @type {Map<string, number>} host -> monotonic time of its last failure */
const failures = new Map();
/** @type {Map<string, Array<() => void>>} hosts being fetched -> callbacks waiting for them */
const pending = new Map();
/**
 * Site name -> host, for this session only: written to disk, the sites would make a
 * browsing history (private windows included).
 * @type {Map<string, string>}
 */
const namesToHosts = new Map();
/** @type {Map<string, Promise<boolean>>} host -> whether all its addresses are public */
const publicHosts = new Map();

/** @type {Soup.Session | null} */
let session = null;

/**
 * @param {PlayerProxy} player
 * @returns {boolean}
 */
export const isBrowserPlayer = (player) => BROWSER.test(`${player.identity} ${player.desktopEntry}`);

/**
 * Host of the page a browser is playing, null for other players.
 * @param {PlayerProxy} player
 * @returns {string | null}
 */
export const getPlayerHost = (player) => {
    if (isBrowserPlayer(player) === false) {
        return null;
    }
    const url = player.metadata?.["xesam:url"];
    if (!url) {
        return getHostFromWindowTitle(player.metadata?.["xesam:title"]);
    }
    try {
        const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
        if (uri.get_scheme() !== "http" && uri.get_scheme() !== "https") {
            return null;
        }
        const host = uri.get_host()?.toLowerCase() ?? null;
        return host != null && isValidHost(host) ? host : null;
    } catch {
        return null;
    }
};

/**
 * Hosts end up in cache file names: GLib decodes "%2f" in hosts, "..%2f.." would leave
 * the cache directory. Only plain DNS names pass.
 * @param {string} host
 * @returns {boolean}
 */
const isValidHost = (host) =>
    host.length <= 253 &&
    /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(host) &&
    host.split(".").every((label) => !label.startsWith("-"));

/**
 * Chromium-based browsers do not publish the page URL over MPRIS. Their window title is
 * "<page title> - Chromium" and most media sites title their pages "<media> - <site>",
 * so the site name sits between the media title and the browser name.
 * @param {string | undefined} title
 * @returns {string | null}
 */
const getHostFromWindowTitle = (title) => {
    if (!title) {
        return null;
    }
    const tracker = Shell.WindowTracker.get_default();
    for (const actor of global.get_window_actors()) {
        const window = actor.meta_window;
        const app = window == null ? null : tracker.get_window_app(window);
        // Only browser windows: any other window could carry the media title too.
        if (app == null || BROWSER.test(`${app.get_id()} ${app.get_name()}`) === false) {
            continue;
        }
        const windowTitle = window.get_title() ?? "";
        // Pages may prefix their title with a notification count: "(3) <media> - YouTube".
        const start = windowTitle.match(/^\(\d+\)\s*/)?.[0].length ?? 0;
        if (windowTitle.startsWith(title, start) === false) {
            continue;
        }
        const parts = windowTitle
            .slice(start + title.length)
            .split(/\s[-–—|·]\s/)
            .map((part) => part.trim())
            .filter((part) => part !== "");
        if (parts.length < 2) {
            continue;
        }
        const name = parts[parts.length - 2];
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (slug === "") {
            return null;
        }
        // Any page can call itself "YouTube": a known host only stands for a name it
        // carries ("youtube" in www.youtube.com).
        const known = namesToHosts.get(name);
        if (known != null && known.split(".").includes(slug)) {
            return known;
        }
        // Last resort, for a site not seen yet in a browser that publishes its URL.
        return `${slug}.com`;
    }
    return null;
};

/**
 * Site already known for this host. Unknown hosts are fetched in the background and
 * onReady is called once they are, so the caller can redraw.
 * @param {string | null} host
 * @param {() => void} onReady
 * @param {string} [pageUrl] Page being played, for sites whose home page declares no icon
 * @returns {Site | null}
 */
export const getSite = (host, onReady, pageUrl) => {
    if (host == null || isValidHost(host) === false) {
        return null;
    }
    if (sites.has(host)) {
        const failedAt = failures.get(host);
        if (failedAt == null || GLib.get_monotonic_time() - failedAt < RETRY_AFTER_MS * 1000) {
            return sites.get(host);
        }
        sites.delete(host);
        failures.delete(host);
    }
    if (pending.has(host)) {
        pending.get(host).push(onReady);
        return null;
    }
    pending.set(host, [onReady]);
    loadSite(host, pageUrl)
        .catch((error) => {
            errorLog(`Failed to load site ${host}:`, error);
            return null;
        })
        .then((site) => {
            sites.set(host, site);
            if (site != null) {
                namesToHosts.set(site.name, host);
            } else {
                failures.set(host, GLib.get_monotonic_time());
            }
            const callbacks = pending.get(host) ?? [];
            pending.delete(host);
            if (site != null) {
                callbacks.forEach((callback) => callback());
            }
        });
    return null;
};

/**
 * @returns {void}
 */
export const clearSites = () => {
    sites.clear();
    failures.clear();
    pending.clear();
    publicHosts.clear();
    namesToHosts.clear();
    session?.abort();
    session = null;
};

/**
 * Full-size 16:9 thumbnail of a YouTube video, the browser only publishes a small one.
 * @param {PlayerProxy} player
 * @returns {string | null}
 */
export const getVideoThumbnailUrl = (player) => {
    // The host can come from the window title, without any URL to read the video id from.
    const url = player.metadata?.["xesam:url"];
    const host = getPlayerHost(player);
    if (!url || host == null || /(^|\.)(youtube\.com|youtu\.be)$/.test(host) === false || host.startsWith("music.")) {
        return null;
    }
    const id =
        url.match(/[?&]v=([\w-]{11})/)?.[1] ??
        url.match(/youtu\.be\/([\w-]{11})/)?.[1] ??
        url.match(/\/(?:embed|live)\/([\w-]{11})/)?.[1];
    return id == null ? null : `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
};

/**
 * @param {string} host
 * @param {string} [pageUrl]
 * @returns {Promise<Site | null>}
 */
const loadSite = async (host, pageUrl) => {
    // Embedded players live on subdomains without a home page (w.soundcloud.com,
    // player.twitch.tv): fall back to the parent domains.
    const labels = host.split(".");
    let found = null;
    for (let i = 0; i <= labels.length - 2 && found == null; i++) {
        found = await fetchSite(labels.slice(i).join("."), i === 0 ? pageUrl : undefined);
    }
    if (found == null) {
        debugLog(`No icon for ${host}`);
        return null;
    }
    const { pixbuf, name } = found;
    // Kept in memory only, see namesToHosts.
    const scaled = scaleToFit(pixbuf, ICON_SIZE);
    return { gicon: Gio.BytesIcon.new(GLib.Bytes.new(scaled.save_to_bufferv("png", [], [])[1])), name };
};

/**
 * @param {string} host
 * @param {string} [pageUrl]
 * @returns {Promise<{ pixbuf: GdkPixbuf.Pixbuf, name: string } | null>}
 */
const fetchSite = async (host, pageUrl) => {
    const homeUrl = `https://${host}/`;
    if (isPublicHttpsUrl(homeUrl) === false) {
        return null;
    }
    const home = await fetch(homeUrl, MAX_PAGE_BYTES);
    const html = home == null ? "" : new TextDecoder().decode(home.toArray());
    let iconUrls = getIconUrls(html, homeUrl);
    // Single-page apps (Crunchyroll) add their icons to the home page with JavaScript, but
    // the pages served for a given video still declare them.
    if (iconUrls.length === 0 && pageUrl != null && isPublicHttpsUrl(pageUrl) && getHost(pageUrl) === host) {
        // Query and fragment can hold session tokens or private links: path only.
        const pagePath = `${homeUrl}${GLib.Uri.parse(pageUrl, GLib.UriFlags.NONE).get_path().replace(/^\//, "")}`;
        const page = await fetch(pagePath, MAX_PAGE_BYTES);
        iconUrls = page == null ? [] : getIconUrls(new TextDecoder().decode(page.toArray()), pagePath);
    }
    for (const url of [...iconUrls, `${homeUrl}favicon.ico`]) {
        const pixbuf = await fetchPixbuf(url);
        if (pixbuf != null) {
            return { pixbuf, name: getSiteName(html) ?? host.replace(/^www\./, "") };
        }
    }
    return null;
};

/**
 * Declared icons, best first: SVG, then the largest bitmap. Apple touch icons come after
 * the regular ones because they are drawn on an opaque tile.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
const getIconUrls = (html, baseUrl) => {
    const candidates = [];
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
        const rel = getAttribute(tag, "rel")?.toLowerCase() ?? "";
        const href = getAttribute(tag, "href");
        if (href == null || /(^|\s)(icon|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel) === false) {
            continue;
        }
        const type = getAttribute(tag, "type") ?? "";
        const sizes = getAttribute(tag, "sizes") ?? "";
        let size = 0;
        for (const match of sizes.matchAll(/(\d{1,5})x\d{1,5}/g)) {
            size = Math.max(size, Number(match[1]));
        }
        let score = type.includes("svg") || /\.svg(\?|$)/i.test(href) ? 1000 : size || 16;
        if (rel.includes("apple-touch-icon")) {
            score = score / 10;
        }
        try {
            const url = GLib.Uri.resolve_relative(baseUrl, decodeEntities(href), GLib.UriFlags.NONE);
            if (isPublicHttpsUrl(url)) {
                candidates.push({ url, score });
            }
        } catch {
            continue;
        }
    }
    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ICON_CANDIDATES)
        .map((candidate) => candidate.url);
};

/**
 * @param {string} url
 * @returns {string | null}
 */
const getHost = (url) => {
    try {
        return GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host()?.toLowerCase() ?? null;
    } catch {
        return null;
    }
};

/**
 * Icon URLs come from the page: never let it point the shell at the local network.
 * @param {string} url
 * @returns {boolean}
 */
const isPublicHttpsUrl = (url) => {
    const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    const host = uri.get_host()?.toLowerCase() ?? "";
    // Real top-level domains are never numeric: rejects "127.1" and other shorthand IPs.
    const tld = host.slice(host.lastIndexOf(".") + 1);
    return (
        uri.get_scheme() === "https" &&
        host.includes(".") &&
        /^([a-z]{2,63}|xn--[a-z0-9-]+)$/.test(tld) &&
        GLib.hostname_is_ip_address(host) === false &&
        /\.(local|localhost|lan|home|internal|arpa)$/.test(host) === false
    );
};

/**
 * A public name can still resolve to a private address: check what it resolves to.
 * Soup resolves again when connecting, this only shuts out names that always point inside.
 * @param {string} host
 * @returns {Promise<boolean>}
 */
const isPublicHost = (host) => {
    if (publicHosts.has(host) === false) {
        const check = /** @type {Promise<Gio.InetAddress[]>} */ (
            /** @type {any} */ (Gio.Resolver.get_default().lookup_by_name_async(host, null))
        )
            .then((addresses) => addresses.length > 0 && addresses.every(isPublicAddress))
            .catch(() => false);
        publicHosts.set(host, check);
    }
    return publicHosts.get(host);
};

/**
 * @param {Gio.InetAddress} address
 * @returns {boolean}
 */
const isPublicAddress = (address) => {
    const text = address.to_string().toLowerCase();
    const isIpv4 = address.get_family() === Gio.SocketFamily.IPV4;
    const [first, second] = isIpv4 ? text.split(".").map(Number) : [parseInt(text.split(":")[0] || "0", 16), 0];
    return !(
        address.get_is_any() ||
        address.get_is_loopback() ||
        address.get_is_link_local() ||
        address.get_is_site_local() ||
        address.get_is_multicast() ||
        // Carrier-grade NAT, also used by Tailscale.
        (isIpv4 && first === 100 && (second & 0xc0) === 64) ||
        (isIpv4 && first === 0) ||
        // IPv6 unique local addresses (fc00::/7) and IPv4-mapped addresses.
        (!isIpv4 && ((first & 0xfe00) === 0xfc00 || text.startsWith("::ffff:")))
    );
};

/**
 * @param {string} html
 * @returns {string | null}
 */
const getSiteName = (html) => {
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
        const key = getAttribute(tag, "property") ?? getAttribute(tag, "name");
        if (key === "og:site_name" || key === "application-name") {
            const content = cleanName(getAttribute(tag, "content") ?? "");
            if (content) {
                return content;
            }
        }
    }
    const title = html.match(/<title[^>]*>([^<]{1,40})<\/title>/i)?.[1];
    return title ? cleanName(title) || null : null;
};

/**
 * Names come from the page and are shown in the panel: decoded, one line, short.
 * @param {string} text
 * @returns {string}
 */
const cleanName = (text) =>
    decodeEntities(text.slice(0, 4 * MAX_NAME_LENGTH))
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_NAME_LENGTH);

/**
 * @param {string} tag
 * @param {string} name
 * @returns {string | null}
 */
const getAttribute = (tag, name) => {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    return match == null ? null : (match[1] ?? match[2] ?? match[3]);
};

/**
 * @param {string} text
 * @returns {string}
 */
const decodeEntities = (text) =>
    text
        .replace(/&#(\d{1,7});/g, (_, code) => toCharacter(Number(code)))
        .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => toCharacter(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

/**
 * @param {number} code
 * @returns {string}
 */
const toCharacter = (code) =>
    code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "";

/**
 * GET limited to maxBytes. Redirects are followed by hand so that every hop is checked.
 * @param {string} url
 * @param {number} maxBytes
 * @returns {Promise<GLib.Bytes | null>}
 */
const fetch = async (url, maxBytes) => {
    session ??= new Soup.Session({ userAgent: USER_AGENT, timeout: 10 });
    try {
        /** @type {Gio.InputStream | null} */
        let stream = null;
        for (let hop = 0; hop <= MAX_REDIRECTS && stream == null; hop++) {
            if (isPublicHttpsUrl(url) === false || (await isPublicHost(GLib.Uri.parse(url, 0).get_host())) === false) {
                return null;
            }
            const message = Soup.Message.new("GET", url);
            if (message == null) {
                return null;
            }
            message.add_flags(Soup.MessageFlags.NO_REDIRECT);
            /** @type {Gio.InputStream} */
            const response = await /** @type {any} */ (session.send_async(message, GLib.PRIORITY_LOW, null));
            const status = message.get_status();
            const location = message.get_response_headers().get_one("Location");
            if (status === Soup.Status.OK) {
                stream = response;
            } else {
                response.close_async(GLib.PRIORITY_LOW, null, null);
                if (status < 300 || status >= 400 || location == null) {
                    return null;
                }
                url = GLib.Uri.resolve_relative(url, location, GLib.UriFlags.NONE);
            }
        }
        if (stream == null) {
            return null;
        }
        const chunks = [];
        let size = 0;
        while (size < maxBytes) {
            /** @type {GLib.Bytes} */
            const chunk = await /** @type {any} */ (
                stream.read_bytes_async(Math.min(65536, maxBytes - size), GLib.PRIORITY_LOW, null)
            );
            if (chunk.get_size() === 0) {
                break;
            }
            chunks.push(chunk.toArray());
            size += chunk.get_size();
        }
        stream.close_async(GLib.PRIORITY_LOW, null, null);
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return GLib.Bytes.new(data);
    } catch {
        return null;
    }
};

/**
 * @param {string} url
 * @returns {Promise<GdkPixbuf.Pixbuf | null>}
 */
const fetchPixbuf = async (url) => {
    const bytes = await fetch(url, MAX_ICON_BYTES);
    if (bytes == null || bytes.get_size() === 0 || bytes.get_size() >= MAX_ICON_BYTES) {
        return null;
    }
    // SVGs without a size would be rendered tiny. .ico files hold several sizes, the
    // loader keeps the largest.
    return decodeImage(bytes, ICON_SIZE);
};

/**
 * @param {GdkPixbuf.Pixbuf} pixbuf
 * @param {number} size
 * @returns {GdkPixbuf.Pixbuf}
 */
const scaleToFit = (pixbuf, size) => {
    const ratio = size / Math.max(pixbuf.width, pixbuf.height);
    if (ratio >= 1) {
        return pixbuf;
    }
    return pixbuf.scale_simple(
        Math.max(1, Math.round(pixbuf.width * ratio)),
        Math.max(1, Math.round(pixbuf.height * ratio)),
        GdkPixbuf.InterpType.HYPER,
    );
};
