#!/usr/bin/env node

// RELEASE-CONTRACT.md §10: artifact type is asserted, not assumed.
//
// `scripts/verify-release-trust.mjs` checks that a *recorded name* ends in the
// extension its platform expects. That is a different question from whether the
// bytes on disk are an installer, and it is the second question that stops the
// worst available failure: a zipped `dist/` or a source archive uploaded under
// an installer name. Renaming is exactly how that happens, so this reads the
// container signature instead of trusting the suffix.

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const TARGET_EXTENSIONS = {
  macos: ['.dmg'],
  windows: ['.msi', '.exe'],
  linux: ['.AppImage', '.deb'],
};

const FORMAT_BY_EXTENSION = {
  '.dmg': 'dmg',
  '.msi': 'msi',
  '.exe': 'nsis',
  '.AppImage': 'appimage',
  '.deb': 'deb',
};

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP = Buffer.from([0x1f, 0x8b]);
const AR = Buffer.from('!<arch>\n', 'ascii');
const NSIS_SIGNATURE = Buffer.from('NullsoftInst', 'ascii');

function fail(message) {
  process.stderr.write(`native-artifact: ${message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

function startsWith(buffer, signature) {
  return buffer.subarray(0, signature.length).equals(signature);
}

/**
 * What the bytes actually are, when that is recognizable. Naming the real
 * container turns "this is not a dmg" into a message that says what went wrong.
 */
function describeContainer(head) {
  if (startsWith(head, ZIP)) return 'a zip archive';
  if (startsWith(head, GZIP)) return 'a gzip archive';
  if (startsWith(head, AR)) return 'an ar archive';
  if (startsWith(head, ELF)) return 'an ELF binary';
  if (startsWith(head, OLE2)) return 'an OLE2 compound document';
  if (startsWith(head, Buffer.from('MZ', 'ascii'))) return 'a PE executable';
  return 'an unrecognized container';
}

/**
 * §6: a pull-request test artifact carries a `.sha256` sidecar so a tester can
 * prove which binary they actually installed. It is written only after the bytes
 * verify, so a sidecar never certifies something that failed the type check.
 */
function writeSidecar(fd, size, path) {
  const hash = createHash('sha256');
  const chunk = 1024 * 1024;
  for (let position = 0; position < size; position += chunk) {
    hash.update(readAt(fd, Math.min(chunk, size - position), position));
  }
  writeFileSync(`${path}.sha256`, `${hash.digest('hex')}  ${basename(path)}\n`);
}

function readAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

/** Chunked so a several-hundred-megabyte installer is never held in memory. */
function containsSignature(fd, size, signature) {
  const chunk = 1024 * 1024;
  const overlap = signature.length - 1;
  for (let position = 0; position < size; position += chunk - overlap) {
    const buffer = readAt(fd, Math.min(chunk, size - position), position);
    if (buffer.includes(signature)) return true;
    if (buffer.length < chunk) break;
  }
  return false;
}

function isPortableExecutable(head) {
  if (!startsWith(head, Buffer.from('MZ', 'ascii')) || head.length < 0x40) return false;
  const offset = head.readUInt32LE(0x3c);
  return offset + 4 <= head.length && head.subarray(offset, offset + 4).equals(Buffer.from('PE\0\0', 'binary'));
}

function verify(format, fd, size, path) {
  const head = readAt(fd, Math.min(size, 64 * 1024), 0);
  const looksLike = describeContainer(head);

  switch (format) {
    case 'dmg': {
      // A UDIF image ends in a 512-byte `koly` trailer. The head of a dmg is
      // compressed payload with no stable signature, so the tail is the check.
      const trailer = readAt(fd, 512, Math.max(0, size - 512));
      if (size < 512 || !startsWith(trailer, Buffer.from('koly', 'ascii'))) {
        return `${path} is not an Apple disk image: the UDIF \`koly\` trailer is absent; it looks like ${looksLike}`;
      }
      return '';
    }
    case 'msi':
      if (!startsWith(head, OLE2)) {
        return `${path} is not an MSI: the OLE2 compound document signature is absent; it looks like ${looksLike}`;
      }
      return '';
    case 'nsis':
      if (!isPortableExecutable(head)) {
        return `${path} is not a Windows executable: no PE header; it looks like ${looksLike}`;
      }
      if (!containsSignature(fd, size, NSIS_SIGNATURE)) {
        return `${path} is a PE executable but not an NSIS installer: the NSIS first header is absent`;
      }
      return '';
    case 'appimage':
      if (!startsWith(head, ELF)) {
        return `${path} is not an AppImage: no ELF header; it looks like ${looksLike}`;
      }
      if (head[8] !== 0x41 || head[9] !== 0x49 || head[10] !== 0x02) {
        return `${path} is an ELF binary but not a type-2 AppImage: the \`AI\\x02\` magic is absent`;
      }
      return '';
    case 'deb':
      if (!startsWith(head, AR) || !head.subarray(8, 21).equals(Buffer.from('debian-binary', 'ascii'))) {
        return `${path} is not a Debian package: no ar archive whose first member is debian-binary; it looks like ${looksLike}`;
      }
      return '';
    default:
      return `unsupported format ${format}`;
  }
}

function main() {
  const target = option('--target');
  const artifact = option('--artifact');

  if (!Object.hasOwn(TARGET_EXTENSIONS, target)) {
    fail(`unknown target ${target || '(none)'}; expected one of ${Object.keys(TARGET_EXTENSIONS).join(', ')}`);
    return;
  }
  if (!artifact) {
    fail('--artifact is required');
    return;
  }

  const path = resolve(artifact);
  const name = basename(path);
  const extension = TARGET_EXTENSIONS[target].find((candidate) => name.endsWith(candidate));
  if (!extension) {
    fail(`${name} is not a ${target} installer: ${target} artifacts must end in ${TARGET_EXTENSIONS[target].join(' or ')}`);
    return;
  }

  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (size === 0) {
    fail(`${path} is empty`);
    return;
  }

  const fd = openSync(path, 'r');
  try {
    const problem = verify(FORMAT_BY_EXTENSION[extension], fd, size, path);
    if (problem) {
      fail(problem);
      return;
    }
    if (process.argv.includes('--sha256-sidecar')) writeSidecar(fd, size, path);
  } finally {
    closeSync(fd);
  }

  process.stdout.write(`native-artifact: ${name} verified as ${FORMAT_BY_EXTENSION[extension]} (${size} bytes)\n`);
}

main();
