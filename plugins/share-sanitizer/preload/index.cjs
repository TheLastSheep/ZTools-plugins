'use strict';
const bridge = {};
const api = globalThis.ztools || {};
if (typeof api.copyText === 'function') bridge.copyText = (text) => api.copyText(String(text));
if (typeof api.copyImage === 'function') bridge.copyImage = (dataUrl) => api.copyImage(String(dataUrl));
globalThis.shareSanitizer = Object.freeze(bridge);
