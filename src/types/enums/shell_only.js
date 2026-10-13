/** @import { Enum } from '../misc.js' */

import Clutter from "gi://Clutter";

export const ControlIconOptions = {
    LOOP_NONE: {
        name: "loop",
        icon: "repeat",
        menuProps: {
            index: 0,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.START,
                opacity: 160,
            },
        },
    },
    LOOP_TRACK: {
        name: "loop",
        icon: "repeat-one",
        menuProps: {
            index: 0,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.START,
            },
        },
    },
    LOOP_PLAYLIST: {
        name: "loop",
        icon: "repeat",
        menuProps: {
            index: 0,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.START,
            },
        },
    },
    SEEK_BACKWARD: {
        name: "seekbackward",
        icon: "seek-backward",
        panelProps: {
            index: 0,
        },
    },
    PREVIOUS: {
        name: "previous",
        icon: "skip-previous",
        menuProps: {
            index: 1,
            options: {
                xExpand: true,
                xAlign: Clutter.ActorAlign.END,
                marginRight: 5,
            },
        },
        panelProps: {
            index: 1,
        },
    },
    PLAY: {
        name: "playpausestop",
        icon: "play",
        menuProps: {
            index: 2,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.CENTER,
            },
        },
        panelProps: {
            index: 2,
        },
    },
    PAUSE: {
        name: "playpausestop",
        icon: "pause",
        menuProps: {
            index: 2,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.CENTER,
            },
        },
        panelProps: {
            index: 2,
        },
    },
    STOP: {
        name: "playpausestop",
        icon: "stop",
        menuProps: {
            index: 2,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.CENTER,
            },
        },
        panelProps: {
            index: 2,
        },
    },
    NEXT: {
        name: "next",
        icon: "skip-next",
        menuProps: {
            index: 3,
            options: {
                xExpand: true,
                xAlign: Clutter.ActorAlign.START,
                marginLeft: 5,
            },
        },
        panelProps: {
            index: 3,
        },
    },
    SEEK_FORWARD: {
        name: "seekforward",
        icon: "seek-forward",
        panelProps: {
            index: 4,
        },
    },
    SHUFFLE_ON: {
        name: "shuffle",
        icon: "shuffle",
        menuProps: {
            index: 4,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.END,
            },
        },
    },
    SHUFFLE_OFF: {
        name: "shuffle",
        icon: "shuffle",
        menuProps: {
            index: 4,
            options: {
                xExpand: false,
                xAlign: Clutter.ActorAlign.END,
                opacity: 160,
            },
        },
    },
};

/** @typedef {Enum<typeof ControlIconOptions>} ControlIconOptions */

/**
 * @typedef {(typeof ControlIconOptions)[
 *     | "LOOP_NONE"
 *     | "LOOP_TRACK"
 *     | "LOOP_PLAYLIST"
 *     | "PREVIOUS"
 *     | "PLAY"
 *     | "PAUSE"
 *     | "NEXT"
 *     | "SHUFFLE_ON"
 *     | "SHUFFLE_OFF"]} MenuControlIconOptions
 */

/**
 * @typedef {(typeof ControlIconOptions)[
 *     | "SEEK_BACKWARD"
 *     | "PREVIOUS"
 *     | "PLAY"
 *     | "PAUSE"
 *     | "NEXT"
 *     | "SEEK_FORWARD"]} PanelControlIconOptions
 */
