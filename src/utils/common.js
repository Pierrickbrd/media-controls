/**
 * @param {...unknown} [args]
 * @returns {void}
 */
export const debugLog = (...args) => {
    console.debug("[Media Controls]", ...args);
};

/**
 * Returns null, so that `promise.catch(errorLog)` resolves to the value or null.
 * @param {...unknown} [args]
 * @returns {null}
 */
export const errorLog = (...args) => {
    console.error("[Media Controls]", ...args);
    return null;
};

/**
 * @template T
 * @param {T} enumObject
 * @param {number} index
 * @returns {any}
 */
export const enumValueByIndex = (enumObject, index) => {
    return Object.values(enumObject)[index];
};

/**
 * @template T
 * @param {T} enumObject
 * @param {unknown} value
 * @returns {string}
 */
export const enumKeyByValue = (enumObject, value) => {
    return Object.keys(enumObject).find((key) => enumObject[key] === value);
};

/**
 * @param {number} ms
 * @returns {string}
 */
export const msToHHMMSS = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(ms / 3600000);
    const secondsString = String(seconds % 60).padStart(2, "0");
    const minutesString = String(minutes % 60).padStart(2, "0");
    const hoursString = String(hours).padStart(2, "0");
    if (hours > 0) {
        return `${hoursString}:${minutesString}:${secondsString}`;
    } else {
        return `${minutesString}:${secondsString}`;
    }
};
