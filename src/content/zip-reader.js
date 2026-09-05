(function () {
  'use strict';

  const NXTK = window.NexusExt = window.NexusExt || {};

  const SIGNATURE = Object.freeze({
    EOCD: 0x06054b50,
    EOCD64: 0x06064b50,
    EOCD64_LOCATOR: 0x07064b50,
    CENTRAL: 0x02014b50,
    LOCAL: 0x04034b50
  });

  const U16_MAX = 0xffff;
  const U32_MAX = 0xffffffff;
  const EOCD_BYTES = 22;
  const MAX_EOCD_SEARCH_BYTES = U16_MAX + EOCD_BYTES + 20;
  const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
  const MAX_DIRECTORY_ENTRIES = 250000;
  const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

  class ZipReaderError extends Error {
    constructor(code, message, cause = null) {
      super(message || code);
      this.name = 'ZipReaderError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  function fail(code, message, cause = null) {
    throw new ZipReaderError(code, message, cause);
  }

  function safeUint64(view, offset, code = 'bad-central-directory') {
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(code, 'The ZIP archive uses offsets too large for this browser.');
    }
    return Number(value);
  }

  async function readView(file, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      fail('bad-entry', 'The ZIP archive contains an invalid byte range.');
    }
    if (start > file.size || end > file.size) {
      fail('bad-entry', 'The ZIP archive points outside the file.');
    }
    return new DataView(await file.slice(start, end).arrayBuffer());
  }

  function findEocd(view) {
    // A real EOCD comment must end exactly at the end of the archive.
    for (let offset = view.byteLength - EOCD_BYTES; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) !== SIGNATURE.EOCD) continue;
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + EOCD_BYTES + commentLength === view.byteLength) return offset;
    }
    return -1;
  }

  function assertSingleDisk(view, diskOffset, centralDiskOffset, entriesOnDisk, entriesTotal) {
    const disk = view.getUint16(diskOffset, true);
    const centralDisk = view.getUint16(centralDiskOffset, true);
    const localEntries = view.getUint16(entriesOnDisk, true);
    const totalEntries = view.getUint16(entriesTotal, true);
    if (disk !== 0 || centralDisk !== 0 || localEntries !== totalEntries) {
      fail('split-archive', 'Split ZIP archives are not supported.');
    }
  }

  async function readDirectoryInfo(file) {
    const tailLength = Math.min(file.size, MAX_EOCD_SEARCH_BYTES);
    const tailStart = file.size - tailLength;
    const tail = await readView(file, tailStart, file.size);
    const eocdOffset = findEocd(tail);
    if (eocdOffset < 0) fail('not-a-zip', 'No ZIP end-of-central-directory record was found.');

    assertSingleDisk(tail, eocdOffset + 4, eocdOffset + 6, eocdOffset + 8, eocdOffset + 10);

    let entries = tail.getUint16(eocdOffset + 10, true);
    let size = tail.getUint32(eocdOffset + 12, true);
    let offset = tail.getUint32(eocdOffset + 16, true);

    // ZIP64 replaces saturated legacy directory fields with 64-bit values.
    if (entries === U16_MAX || size === U32_MAX || offset === U32_MAX) {
      const locatorOffset = eocdOffset - 20;
      if (locatorOffset < 0 || tail.getUint32(locatorOffset, true) !== SIGNATURE.EOCD64_LOCATOR) {
        fail('zip64-missing', 'The ZIP64 locator is missing.');
      }
      if (tail.getUint32(locatorOffset + 4, true) !== 0 || tail.getUint32(locatorOffset + 16, true) !== 1) {
        fail('split-archive', 'Split ZIP64 archives are not supported.');
      }

      const zip64Offset = safeUint64(tail, locatorOffset + 8, 'zip64-missing');
      const zip64 = await readView(file, zip64Offset, zip64Offset + 56);
      if (zip64.getUint32(0, true) !== SIGNATURE.EOCD64) {
        fail('zip64-missing', 'The ZIP64 directory record is invalid.');
      }
      if (safeUint64(zip64, 4, 'zip64-missing') < 44) {
        fail('zip64-missing', 'The ZIP64 directory record is truncated.');
      }
      if (zip64.getUint32(16, true) !== 0 || zip64.getUint32(20, true) !== 0) {
        fail('split-archive', 'Split ZIP64 archives are not supported.');
      }
      const localEntries = safeUint64(zip64, 24, 'zip64-missing');
      entries = safeUint64(zip64, 32, 'zip64-missing');
      if (localEntries !== entries) fail('split-archive', 'Split ZIP64 archives are not supported.');
      size = safeUint64(zip64, 40, 'zip64-missing');
      offset = safeUint64(zip64, 48, 'zip64-missing');
    }

    if (entries > MAX_DIRECTORY_ENTRIES || size > MAX_DIRECTORY_BYTES) {
      fail('archive-too-large', 'The ZIP directory is too large to inspect safely.');
    }
    if (!Number.isSafeInteger(offset + size) || offset + size > file.size) {
      fail('bad-central-directory', 'The ZIP directory points outside the file.');
    }
    return { entries, size, offset };
  }

  function readZip64Extra(view, start, length, fields) {
    const end = start + length;
    let offset = start;
    while (offset + 4 <= end) {
      const headerId = view.getUint16(offset, true);
      const dataSize = view.getUint16(offset + 2, true);
      const dataStart = offset + 4;
      const dataEnd = dataStart + dataSize;
      if (dataEnd > end) fail('bad-central-directory', 'A ZIP extra field is truncated.');
      if (headerId === 0x0001) {
        const values = {};
        let cursor = dataStart;
        for (const field of fields) {
          if (cursor + 8 > dataEnd) fail('zip64-missing', 'A ZIP64 entry field is missing.');
          values[field] = safeUint64(view, cursor, 'zip64-missing');
          cursor += 8;
        }
        return values;
      }
      offset = dataEnd;
    }
    if (fields.length) fail('zip64-missing', 'The ZIP64 entry metadata is missing.');
    return {};
  }

  function matchesAsciiName(view, start, length, wantedName) {
    if (length !== wantedName.length) return false;
    for (let index = 0; index < length; index += 1) {
      if (view.getUint8(start + index) !== wantedName.charCodeAt(index)) return false;
    }
    return true;
  }

  async function findEntry(file, wantedName, maxBytes) {
    const directory = await readDirectoryInfo(file);
    const view = await readView(file, directory.offset, directory.offset + directory.size);
    let offset = 0;

    for (let index = 0; index < directory.entries; index += 1) {
      if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== SIGNATURE.CENTRAL) {
        fail('bad-central-directory', 'The ZIP directory contains an invalid entry.');
      }

      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const crc32 = view.getUint32(offset + 16, true);
      let compressedSize = view.getUint32(offset + 20, true);
      let uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const diskStart = view.getUint16(offset + 34, true);
      let localOffset = view.getUint32(offset + 42, true);
      const nameStart = offset + 46;
      const nextOffset = nameStart + nameLength + extraLength + commentLength;
      if (nextOffset > view.byteLength) fail('bad-central-directory', 'A ZIP directory entry is truncated.');

      if (matchesAsciiName(view, nameStart, nameLength, wantedName)) {
        if (diskStart !== 0) fail('split-archive', 'Split ZIP entries are not supported.');
        if (flags & 0x0041) fail('encrypted-entry', 'Encrypted ZIP entries are not supported.');
        if (method !== 0 && method !== 8) {
          fail('unsupported-compression', `Unsupported ZIP compression method ${method}.`);
        }

        const fields = [];
        if (uncompressedSize === U32_MAX) fields.push('uncompressedSize');
        if (compressedSize === U32_MAX) fields.push('compressedSize');
        if (localOffset === U32_MAX) fields.push('localOffset');
        const wide = readZip64Extra(view, nameStart + nameLength, extraLength, fields);
        if (wide.uncompressedSize !== undefined) uncompressedSize = wide.uncompressedSize;
        if (wide.compressedSize !== undefined) compressedSize = wide.compressedSize;
        if (wide.localOffset !== undefined) localOffset = wide.localOffset;

        if (uncompressedSize > maxBytes || compressedSize > maxBytes + 1024 * 1024) {
          fail('entry-too-large', 'The requested ZIP entry is too large to read safely.');
        }
        if (method === 0 && compressedSize !== uncompressedSize) {
          fail('corrupt-entry', 'The stored ZIP entry has inconsistent sizes.');
        }
        return { flags, method, crc32, compressedSize, uncompressedSize, localOffset };
      }
      offset = nextOffset;
    }
    return null;
  }

  async function inflateRaw(bytes, maxBytes) {
    if (typeof DecompressionStream !== 'function') {
      fail('no-inflate', 'This browser cannot decompress ZIP entries.');
    }

    let reader;
    try {
      reader = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))
        .getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch (_) { }
          fail('entry-too-large', 'The decompressed ZIP entry exceeds the safety limit.');
        }
        chunks.push(value);
      }
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    } catch (cause) {
      if (cause instanceof ZipReaderError) throw cause;
      fail('corrupt-entry', 'The ZIP entry could not be decompressed.', cause);
    } finally {
      reader?.releaseLock?.();
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  async function readEntry(file, wantedName, { maxBytes = DEFAULT_MAX_ENTRY_BYTES } = {}) {
    if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size)) {
      fail('no-file', 'No readable ZIP file was provided.');
    }
    if (!/^[\x20-\x7e]{1,255}$/.test(wantedName || '')) {
      fail('bad-entry-name', 'The requested ZIP entry name is invalid.');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      fail('bad-limit', 'The ZIP entry limit is invalid.');
    }

    const entry = await findEntry(file, wantedName, maxBytes);
    if (!entry) return null;

    const local = await readView(file, entry.localOffset, entry.localOffset + 30);
    if (local.getUint32(0, true) !== SIGNATURE.LOCAL) {
      fail('bad-entry', 'The ZIP entry has no valid local header.');
    }
    const localFlags = local.getUint16(6, true);
    const localMethod = local.getUint16(8, true);
    if ((localFlags & 0x0041) || localMethod !== entry.method) {
      fail('bad-entry', 'The ZIP entry header does not match its directory record.');
    }

    const nameLength = local.getUint16(26, true);
    const extraLength = local.getUint16(28, true);
    const nameStart = entry.localOffset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > file.size) {
      fail('bad-entry', 'The ZIP entry data points outside the file.');
    }

    const localName = await readView(file, nameStart, nameStart + nameLength);
    if (!matchesAsciiName(localName, 0, nameLength, wantedName)) {
      fail('bad-entry', 'The ZIP entry name does not match its directory record.');
    }

    const compressed = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
    const output = entry.method === 0 ? compressed : await inflateRaw(compressed, maxBytes);

    // Validate size and checksum before exposing untrusted archive data.
    if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.crc32) {
      fail('corrupt-entry', 'The ZIP entry failed its integrity check.');
    }
    return output;
  }

  NXTK.ZipReader = Object.freeze({ ZipReaderError, readEntry });
})();
