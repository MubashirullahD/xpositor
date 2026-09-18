// QR rendering for the offline pairing panel.
// The qrcode package handles QR version selection, masking, and error correction.

const QRCode = require('qrcode');

function qrSvg(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const moduleSize = qr.modules.size;
  const border = 4;
  const size = moduleSize + border * 2;
  const path = [];
  for (let y = 0; y < moduleSize; y += 1) {
    for (let x = 0; x < moduleSize; x += 1) {
      if (qr.modules.data[y * moduleSize + x]) path.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Patchwork phone pairing QR code"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${path.join('')}"/></svg>`;
}

module.exports = { qrSvg };
