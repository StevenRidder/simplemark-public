import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The first four-platform build run failed on both non-macOS legs for the same
// reason: `src-tauri/tauri.conf.json` listed only `icons/icon.icns`, so
// `tauri-build` could not find `icons/icon.ico` on Windows and the AppImage
// bundler could not find "a square icon to use as AppImage icon" on Linux.
// Neither failure is visible until a native runner is twenty minutes into a
// compile, which is an expensive place to learn it. These assertions move that
// discovery into the local gate, where it costs nothing.

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as { bundle: { icon: string[] } };

const icons: string[] = config.bundle.icon;

function bytes(icon: string): Buffer {
  return readFileSync(join(process.cwd(), 'src-tauri', icon));
}

/** Width and height out of a PNG's IHDR chunk. */
function pngSize(icon: string): [number, number] {
  const buffer = bytes(icon);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

describe('native icon set', () => {
  it('lists an icon for every platform the release matrix builds', () => {
    expect(icons.some((icon) => icon.endsWith('.icns')), 'macOS needs an .icns').toBe(true);
    expect(icons.some((icon) => icon.endsWith('.ico')), 'Windows tauri-build needs an .ico').toBe(true);
    expect(icons.some((icon) => icon.endsWith('.png')), 'the AppImage bundler needs a square PNG').toBe(true);
  });

  it('ships every icon it lists', () => {
    for (const icon of icons) {
      expect(existsSync(join(process.cwd(), 'src-tauri', icon)), `${icon} is listed but absent`).toBe(true);
    }
  });

  it('lists PNGs that are actually square, which is what the AppImage bundler requires', () => {
    const pngs = icons.filter((icon) => icon.endsWith('.png'));
    expect(pngs.length).toBeGreaterThan(0);
    for (const icon of pngs) {
      const [width, height] = pngSize(icon);
      expect(width, `${icon} is ${width}x${height}`).toBe(height);
    }
  });

  it('ships real icon containers, not renamed images', () => {
    for (const icon of icons) {
      const head = bytes(icon).subarray(0, 8);
      if (icon.endsWith('.icns')) expect(head.subarray(0, 4).toString('ascii')).toBe('icns');
      if (icon.endsWith('.ico')) expect([...head.subarray(0, 4)]).toEqual([0x00, 0x00, 0x01, 0x00]);
      if (icon.endsWith('.png')) expect([...head.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});
