import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RELEASE-CONTRACT.md §10: "Artifact type is asserted, not assumed." The failure
// this guards against is the worst one available — a zipped `dist/` or a source
// archive uploaded under an installer name, so a tester downloads something that
// cannot possibly install. Extension checking alone cannot catch that, because
// renaming a zip is exactly how it happens. So the check reads the bytes, and
// these tests feed it the real container signatures rather than a plausible
// stand-in.

const script = join(process.cwd(), 'scripts', 'verify-native-artifact.mjs');

function artifact(name: string, bytes: Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), 'simplemark-native-artifact-'));
  const path = join(directory, name);
  writeFileSync(path, bytes);
  return path;
}

function run(target: string, path: string) {
  return spawnSync(process.execPath, [script, '--target', target, '--artifact', path], {
    encoding: 'utf8',
  });
}

function pad(buffer: Buffer, size: number): Buffer {
  return Buffer.concat([buffer, Buffer.alloc(Math.max(0, size - buffer.length))]);
}

/** A UDIF disk image is identified by its trailing 512-byte `koly` block. */
function dmg(): Buffer {
  const trailer = pad(Buffer.from('koly', 'ascii'), 512);
  return Buffer.concat([pad(Buffer.from('payload', 'ascii'), 4096), trailer]);
}

/** An MSI is an OLE2 compound document. */
function msi(): Buffer {
  return pad(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 4096);
}

/** An NSIS installer is a PE executable carrying the NSIS first header. */
function nsis(): Buffer {
  const header = pad(Buffer.from('MZ', 'ascii'), 0x80);
  header.writeUInt32LE(0x40, 0x3c); // e_lfanew
  header.write('PE\0\0', 0x40, 'binary');
  return Buffer.concat([header, Buffer.from('....NullsoftInst....', 'binary'), Buffer.alloc(2048)]);
}

/** A type-2 AppImage is an ELF whose e_ident padding carries `AI\x02`. */
function appImage(): Buffer {
  const elf = pad(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), 4096);
  elf[8] = 0x41;
  elf[9] = 0x49;
  elf[10] = 0x02;
  return elf;
}

/** A .deb is an ar archive whose first member is `debian-binary`. */
function deb(): Buffer {
  return Buffer.concat([
    Buffer.from('!<arch>\n', 'ascii'),
    Buffer.from('debian-binary   1700000000  0     0     100644  4         `\n', 'ascii'),
    Buffer.from('2.0\n', 'ascii'),
  ]);
}

/** What a zipped `dist/` looks like: a PKZIP local file header. */
function zip(): Buffer {
  return pad(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 4096);
}

/** What a source archive looks like: a gzip member. */
function tarball(): Buffer {
  return pad(Buffer.from([0x1f, 0x8b, 0x08, 0x00]), 4096);
}

describe('native artifact verification', () => {
  it('accepts a real UDIF disk image on macOS', () => {
    const result = run('macos', artifact('SimpleMark-0.0.0-macos-arm64.dmg', dmg()));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified as dmg');
  });

  it('accepts a real MSI and a real NSIS installer on Windows', () => {
    expect(run('windows', artifact('SimpleMark-0.0.0-windows-x64.msi', msi())).status).toBe(0);
    expect(run('windows', artifact('SimpleMark-0.0.0-windows-x64-setup.exe', nsis())).status).toBe(0);
  });

  it('accepts a real type-2 AppImage and a real .deb on Linux', () => {
    expect(run('linux', artifact('SimpleMark-0.0.0-linux-x64.AppImage', appImage())).status).toBe(0);
    expect(run('linux', artifact('SimpleMark-0.0.0-linux-x64.deb', deb())).status).toBe(0);
  });

  it('rejects a zipped web bundle renamed to every installer extension', () => {
    for (const [target, name] of [
      ['macos', 'SimpleMark-0.0.0-macos-arm64.dmg'],
      ['windows', 'SimpleMark-0.0.0-windows-x64.msi'],
      ['windows', 'SimpleMark-0.0.0-windows-x64-setup.exe'],
      ['linux', 'SimpleMark-0.0.0-linux-x64.AppImage'],
      ['linux', 'SimpleMark-0.0.0-linux-x64.deb'],
    ] as const) {
      const result = run(target, artifact(name, zip()));
      expect(result.status, `${name} must not pass as an installer`).toBe(1);
      expect(result.stderr).toContain('zip archive');
    }
  });

  it('rejects a source tarball renamed to an installer', () => {
    const result = run('linux', artifact('SimpleMark-0.0.0-linux-x64.AppImage', tarball()));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gzip archive');
  });

  it('rejects a type-1 AppImage, because Tauri emits type 2', () => {
    const legacy = appImage();
    legacy[10] = 0x01;
    const result = run('linux', artifact('SimpleMark-0.0.0-linux-x64.AppImage', legacy));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AppImage');
  });

  it('rejects a PE executable that is not an NSIS installer', () => {
    const bare = pad(Buffer.from('MZ', 'ascii'), 0x80);
    bare.writeUInt32LE(0x40, 0x3c);
    bare.write('PE\0\0', 0x40, 'binary');
    const result = run('windows', artifact('SimpleMark-0.0.0-windows-x64-setup.exe', Buffer.concat([bare, Buffer.alloc(2048)])));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NSIS');
  });

  it('rejects a zero-byte artifact, naming the path', () => {
    const path = artifact('SimpleMark-0.0.0-macos-arm64.dmg', Buffer.alloc(0));
    const result = run('macos', path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is empty');
    expect(result.stderr).toContain(path);
  });

  it('rejects a missing artifact, naming the path it expected', () => {
    const path = join(tmpdir(), 'simplemark-absent', 'SimpleMark-0.0.0-macos-arm64.dmg');
    const result = run('macos', path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
  });

  it('rejects an extension the platform does not produce', () => {
    const result = run('macos', artifact('SimpleMark-0.0.0-macos-arm64.AppImage', appImage()));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('macos');
  });

  it('rejects an unknown target rather than passing it through', () => {
    const result = run('freebsd', artifact('SimpleMark-0.0.0-linux-x64.deb', deb()));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('target');
  });

  // §6: "Pull-request test artifacts each carry a `.sha256` sidecar, so a tester
  // can prove which binary they actually installed when they report what it did."
  it('writes a sha256sum -c sidecar for a verified artifact', () => {
    const bytes = dmg();
    const path = artifact('SimpleMark-0.0.0-macos-arm64.dmg', bytes);
    const result = spawnSync(
      process.execPath,
      [script, '--target', 'macos', '--artifact', path, '--sha256-sidecar'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(`${path}.sha256`, 'utf8'))
      .toBe(`${createHash('sha256').update(bytes).digest('hex')}  ${basename(path)}\n`);
  });

  it('writes no sidecar for an artifact that failed verification', () => {
    const path = artifact('SimpleMark-0.0.0-macos-arm64.dmg', zip());
    const result = spawnSync(
      process.execPath,
      [script, '--target', 'macos', '--artifact', path, '--sha256-sidecar'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(existsSync(`${path}.sha256`)).toBe(false);
  });
});
