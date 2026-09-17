const assert = require('node:assert/strict');
const { qrSvg } = require('../qr.js');

const url = 'http://192.168.0.104:4321/?token=321d61a0d38ba8dcf32b270074f8bf87ad41';
const svg = qrSvg(url);

assert.match(svg, /^<svg /);
assert.match(svg, /viewBox="0 0 41 41"/);
assert.match(svg, /shape-rendering="crispEdges"/);
assert.match(svg, /fill="#000"/);
assert.match(svg, /<path /);
assert.ok(svg.length > 1000, 'QR SVG should contain a full matrix');
assert.throws(() => qrSvg('x'.repeat(140)), /too long/i);

console.log(JSON.stringify({ qr: 'ok', modules: 33, payload: url.length }));
