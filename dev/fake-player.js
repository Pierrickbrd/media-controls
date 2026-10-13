// Faux lecteur MPRIS pour tester l'extension dans une session imbriquée.
// gjs -m fake-player.js <nom> <identité> <desktop entry> <titre> <artiste> <artUrl> <url>
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const [name, identity, entry, title, artist, artUrl, url] = ARGV;
const xml = `<node>
<interface name="org.mpris.MediaPlayer2">
  <property name="Identity" type="s" access="read"/><property name="DesktopEntry" type="s" access="read"/>
  <property name="CanQuit" type="b" access="read"/><property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/><property name="SupportedUriSchemes" type="as" access="read"/>
  <property name="SupportedMimeTypes" type="as" access="read"/>
  <method name="Raise"/><method name="Quit"/>
</interface>
<interface name="org.mpris.MediaPlayer2.Player">
  <method name="Next"/><method name="Previous"/><method name="Pause"/><method name="PlayPause"/>
  <method name="Stop"/><method name="Play"/>
  <method name="Seek"><arg direction="in" type="x"/></method>
  <method name="SetPosition"><arg direction="in" type="o"/><arg direction="in" type="x"/></method>
  <method name="OpenUri"><arg direction="in" type="s"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/><property name="LoopStatus" type="s" access="readwrite"/>
  <property name="Rate" type="d" access="readwrite"/><property name="Shuffle" type="b" access="readwrite"/>
  <property name="Metadata" type="a{sv}" access="read"/><property name="Volume" type="d" access="readwrite"/>
  <property name="Position" type="x" access="read"/><property name="MinimumRate" type="d" access="read"/>
  <property name="MaximumRate" type="d" access="read"/><property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/><property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/><property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`;
const state = { PlaybackStatus: "Playing", LoopStatus: "None", Shuffle: false, Volume: 1, Rate: 1 };
const meta = {
    "mpris:trackid": new GLib.Variant("o", "/org/mpris/MediaPlayer2/fake"),
    "xesam:title": new GLib.Variant("s", title),
    "xesam:artist": new GLib.Variant("as", [artist]),
    "mpris:length": new GLib.Variant("x", 2542000000),
};
if (artUrl) meta["mpris:artUrl"] = new GLib.Variant("s", artUrl);
if (url) meta["xesam:url"] = new GLib.Variant("s", url);
const props = {
    Identity: ["s", identity], DesktopEntry: ["s", entry], CanQuit: ["b", true], CanRaise: ["b", true],
    HasTrackList: ["b", false], SupportedUriSchemes: ["as", []], SupportedMimeTypes: ["as", []],
    Position: ["x", 328000000], MinimumRate: ["d", 1], MaximumRate: ["d", 1], CanGoNext: ["b", true],
    CanGoPrevious: ["b", true], CanPlay: ["b", true], CanPause: ["b", true], CanSeek: ["b", true], CanControl: ["b", true],
};
const types = { PlaybackStatus: "s", LoopStatus: "s", Shuffle: "b", Volume: "d", Rate: "d" };
const node = Gio.DBusNodeInfo.new_for_xml(xml);
const get = (prop) => prop === "Metadata" ? new GLib.Variant("a{sv}", meta)
    : prop in state ? new GLib.Variant(types[prop], state[prop]) : new GLib.Variant(...props[prop]);
for (const iface of node.interfaces) {
    Gio.DBus.session.register_object(`/org/mpris/MediaPlayer2`, iface,
        (_c, _s, _p, _i, method, _params, inv) => {
            if (method === "PlayPause") state.PlaybackStatus = state.PlaybackStatus === "Playing" ? "Paused" : "Playing";
            if (method === "Play") state.PlaybackStatus = "Playing";
            if (method === "Pause") state.PlaybackStatus = "Paused";
            inv.return_value(null);
            Gio.DBus.session.emit_signal(null, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties", "PropertiesChanged",
                new GLib.Variant("(sa{sv}as)", ["org.mpris.MediaPlayer2.Player", { PlaybackStatus: get("PlaybackStatus") }, []]));
        },
        (_c, _s, _p, _i, prop) => get(prop),
        (_c, _s, _p, _i, prop, value) => { state[prop] = value.deepUnpack(); return true; });
}
Gio.bus_own_name_on_connection(Gio.DBus.session, `org.mpris.MediaPlayer2.${name}`, 0, null, null);
new GLib.MainLoop(null, false).run();
