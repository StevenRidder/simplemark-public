import { readFileSync } from 'node:fs'

/**
 * The ten acceptance fixtures from DESIGN.md §12.
 *
 * The gate is: every fixture is byte-identical after an untouched save, and a
 * single-block edit leaves every other block byte-identical. `tests` records
 * what each file is here to catch, so a fixture cannot quietly drift into
 * testing nothing.
 */
export interface FidelityFixture {
  /** Fixture number as listed in DESIGN.md §12. */
  readonly id: number
  /** File name within `tests/fixtures`. */
  readonly file: string
  /** The normalisation this fixture is designed to catch. */
  readonly tests: string
}

export const FIDELITY_FIXTURES: readonly FidelityFixture[] = [
  {
    id: 1,
    file: '01-hostile-markdown.md',
    tests: 'Hostile input: nested tables, inline links in cells, anchors, mixed lists',
  },
  {
    id: 2,
    file: '02-front-matter-comments.md',
    tests: 'YAML front matter with comments and unusual ordering — preservation without reordering',
  },
  {
    id: 3,
    file: '03-embedded-html.md',
    tests: 'Arbitrary embedded HTML (<details>, <img>, raw <svg>) — opaque preservation',
  },
  {
    id: 4,
    file: '04-mixed-list-markers.md',
    tests: 'Deeply nested and mixed-marker lists (-, *, 1., 1)) — no marker normalization',
  },
  {
    id: 5,
    file: '05-ragged-tables.md',
    tests: 'Tables with ragged padding and alignment rows — no repadding',
  },
  {
    id: 6,
    file: '06-reference-links-footnotes.md',
    tests: 'Reference-style links and footnotes — definitions stay where the author put them',
  },
  {
    id: 7,
    file: '07-unusual-fences.md',
    tests: 'Fenced code with ~~~, backtick counts > 3, and nested fences — fence style preserved',
  },
  {
    id: 8,
    file: '08-mermaid-and-bare-diagram.md',
    tests: 'A mermaid block plus a bare pasted diagram — conversion and serialization agree',
  },
  {
    id: 9,
    file: '09-byte-level-hostility.md',
    tests: 'Hard tabs, CRLF, trailing whitespace, no trailing newline — byte-level faithfulness',
  },
  {
    id: 10,
    file: '10-external-edit-reopen.md',
    tests: 'Externally edited file re-opened mid-session — source map rebuilds correctly',
  },
]

/**
 * Reads a fixture as raw bytes. Never as a string: decoding and re-encoding is
 * exactly the kind of round trip the fidelity contract forbids, and it would
 * hide a lone CR or an invalid sequence behind a replacement character.
 */
export function readFixture(fixture: FidelityFixture): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${fixture.file}`, import.meta.url)))
}
