'use strict';

function normalizeUploadFilename(filename) {
  const value = String(filename || '');

  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }

  if ([...value].some(character => character.codePointAt(0) > 0xFF)) {
    return value;
  }

  const originalBytes = Buffer.from(value, 'latin1');
  const decoded = originalBytes.toString('utf8');

  if (decoded.includes('\uFFFD') || !Buffer.from(decoded, 'utf8').equals(originalBytes)) {
    return value;
  }

  return decoded;
}

module.exports = {
  normalizeUploadFilename
};
