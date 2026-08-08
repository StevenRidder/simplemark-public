/**
 * The small, local Tabler icon subset used by SimpleMark's shell.
 *
 * Source: https://github.com/tabler/tabler-icons/tree/main/icons/outline
 * Tabler Icons are MIT licensed. We vendor paths instead of loading a font,
 * package, or remote asset so the native app stays tiny and works offline.
 */

export type TablerIconName =
  | 'alert-triangle'
  | 'archive'
  | 'arrow-down'
  | 'bold'
  | 'calendar'
  | 'checkbox'
  | 'chevron-down'
  | 'dots'
  | 'dots-vertical'
  | 'folder'
  | 'folder-plus'
  | 'grip-vertical'
  | 'heading'
  | 'highlight'
  | 'italic'
  | 'link'
  | 'list'
  | 'note'
  | 'notes'
  | 'pencil-plus'
  | 'photo'
  | 'pin'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'square'
  | 'table'
  | 'trash'
  | 'x'

const paths: Record<TablerIconName, string> = {
  'alert-triangle':
    '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/>',
  archive:
    '<path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"/><path d="M10 12l4 0"/>',
  'arrow-down': '<path d="M12 5l0 14"/><path d="M18 13l-6 6"/><path d="M6 13l6 6"/>',
  bold:
    '<path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6l0 -7"/><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7"/>',
  calendar:
    '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12"/><path d="M16 3v4M8 3v4M4 11h16M11 15h1M12 15v3"/>',
  checkbox:
    '<path d="M9 11l3 3l8 -8"/><path d="M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9"/>',
  'chevron-down': '<path d="M6 9l6 6l6 -6"/>',
  dots:
    '<path d="M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
  'dots-vertical':
    '<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
  folder:
    '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"/>',
  'folder-plus':
    '<path d="M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5"/><path d="M16 19h6M19 16v6"/>',
  'grip-vertical':
    '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  heading: '<path d="M7 12h10M7 5v14M17 5v14M15 19h4M15 5h4M5 19h4M5 5h4"/>',
  highlight:
    '<path d="M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M12.5 5.5l4 4M4.5 13.5l4 4M21 15v4h-8l4 -4l4 0"/>',
  italic: '<path d="M11 5l6 0M7 19l6 0M14 5l-4 14"/>',
  link:
    '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
  list: '<path d="M9 6l11 0M9 12l11 0M9 18l11 0M5 6l0 .01M5 12l0 .01M5 18l0 .01"/>',
  note:
    '<path d="M13 20l7 -7"/><path d="M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7"/>',
  notes:
    '<path d="M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14"/><path d="M9 7l6 0M9 11l6 0M9 15l4 0"/>',
  'pencil-plus':
    '<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4M16 19h6M19 16v6"/>',
  photo:
    '<path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3"/>',
  pin:
    '<path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5M14.5 4l5.5 5.5"/>',
  refresh:
    '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  search:
    '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
  settings:
    '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',
  square:
    '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14"/>',
  table:
    '<path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14M3 10h18M10 3v18"/>',
  trash:
    '<path d="M4 7l16 0M10 11l0 6M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>',
  x: '<path d="M18 6l-12 12M6 6l12 12"/>',
}

export function tablerIcon(name: TablerIconName, className?: string): string {
  const classAttribute = className === undefined ? '' : ` class="${className}"`
  return `<svg${classAttribute} viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}

export function tablerIconPaths(name: TablerIconName): string {
  return paths[name]
}
