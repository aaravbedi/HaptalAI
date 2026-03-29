/**
 * Minimal .npy file encoder for browser-side download.
 * Encodes a Float64Array as a NumPy .npy file (v1.0 format).
 */

/**
 * Encode a Float64Array into a .npy file blob.
 * @param {Float64Array} data - 1D array of values
 * @param {number[]} shape - e.g. [64, 64]
 * @returns {Blob}
 */
export function encodeNpy(data, shape = [64, 64]) {
  const header = `{'descr': '<f8', 'fortran_order': False, 'shape': (${shape.join(', ')},), }`;
  // Pad header to be aligned to 64 bytes (including magic + version + header_len)
  const preambleLen = 10; // magic(6) + version(2) + header_len(2)
  const totalHeaderLen = preambleLen + header.length + 1; // +1 for \n
  const padding = 64 - (totalHeaderLen % 64);
  const paddedHeader = header + ' '.repeat(padding) + '\n';

  const headerBytes = new TextEncoder().encode(paddedHeader);
  const headerLen = headerBytes.length;

  const buf = new ArrayBuffer(preambleLen + headerLen + data.byteLength);
  const view = new DataView(buf);

  // Magic: \x93NUMPY
  view.setUint8(0, 0x93);
  view.setUint8(1, 0x4E); // N
  view.setUint8(2, 0x55); // U
  view.setUint8(3, 0x4D); // M
  view.setUint8(4, 0x50); // P
  view.setUint8(5, 0x59); // Y
  // Version 1.0
  view.setUint8(6, 1);
  view.setUint8(7, 0);
  // Header length (little-endian uint16)
  view.setUint16(8, headerLen, true);

  // Header string
  const uint8 = new Uint8Array(buf);
  uint8.set(headerBytes, preambleLen);

  // Data (Float64)
  const dataView = new Float64Array(buf, preambleLen + headerLen);
  dataView.set(data);

  return new Blob([buf], { type: 'application/octet-stream' });
}

/**
 * Trigger a browser download of a Blob.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
