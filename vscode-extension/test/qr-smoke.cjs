const assert = require('node:assert/strict');
const fs = require('node:fs');
const { qrSvg } = require('../qr.js');

const url = 'http://192.168.0.104:4321/?token=321d61a0d38ba8dcf32b270074f8bf87ad41';
const svg = qrSvg(url);
const quickTunnelUrl = 'https://generations-pixels-framing-economic.trycloudflare.com/?token=' + 'a'.repeat(24);
const quickTunnelSvg = qrSvg(quickTunnelUrl);

assert.match(svg, /^<svg /);
assert.match(svg, /viewBox="0 0 41 41"/);
assert.match(svg, /shape-rendering="crispEdges"/);
assert.match(svg, /fill="#000"/);
assert.match(svg, /<path /);
assert.ok(svg.length > 1000, 'QR SVG should contain a full matrix');
assert.match(quickTunnelSvg, /^<svg /);
assert.doesNotThrow(() => qrSvg('x'.repeat(140)));

const manifest = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '..', 'package.json'), 'utf8'));
assert.ok(manifest.activationEvents.includes('onView:patchwork.pairing'));
assert.ok(manifest.contributes.viewsContainers.activitybar.some((container) => container.id === 'patchwork'));
assert.ok(manifest.contributes.views.patchwork.some((view) => view.id === 'patchwork.pairing' && view.type === 'webview'));
assert.equal(manifest.contributes.configuration.properties['patchwork.autoStart'].default, false);
assert.equal(manifest.contributes.configuration.properties['patchwork.cloudflaredPath'].default, 'cloudflared');
assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', 'resources', 'patchwork-activity.svg')));

console.log(JSON.stringify({ qr: 'ok', activityBar: 'ok', quickTunnel: 'ok', modules: 33, payload: url.length }));
