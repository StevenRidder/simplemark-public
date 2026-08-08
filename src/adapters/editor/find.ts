import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * In-document find (EDITOR-7).
 *
 * The match set is plugin state; matches render as inline decorations, so the
 * document itself is untouched and the serialised Markdown is byte-identical
 * with a search active. Match positions are recomputed on every doc change
 * while a query is live — a find that silently drifts as you edit would be
 * worse than no find.
 *
 * The overlay UI lives in `app/ui`; this plugin only answers "where are the
 * matches and which one is current".
 */

export const findKey = new PluginKey<FindState>('simplemark-find')

export interface FindState {
  readonly query: string
  /** Start positions of every match, in document order. */
  readonly matches: ReadonlyArray<{ from: number; to: number }>
  /** Index into `matches`, or -1 when there are none. */
  readonly active: number
}

interface FindMeta {
  readonly query?: string
  /** Move the active match: 1 forward, -1 back. */
  readonly step?: 1 | -1
}

const EMPTY: FindState = { query: '', matches: [], active: -1 }

/** Case-insensitive plain-text search across every text node. */
function findMatches(state: EditorState, query: string): Array<{ from: number; to: number }> {
  if (query === '') return []
  const needle = query.toLowerCase()
  const matches: Array<{ from: number; to: number }> = []
  state.doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) return true
    const haystack = node.text.toLowerCase()
    let index = haystack.indexOf(needle)
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + needle.length })
      index = haystack.indexOf(needle, index + 1)
    }
    return true
  })
  return matches
}

export function findProsePlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply: (tr, state, _oldState, newState) => {
        const meta = tr.getMeta(findKey) as FindMeta | undefined

        if (meta?.query !== undefined) {
          const matches = findMatches(newState, meta.query)
          return { query: meta.query, matches, active: matches.length > 0 ? 0 : -1 }
        }
        if (meta?.step !== undefined && state.matches.length > 0) {
          const active =
            (state.active + meta.step + state.matches.length) % state.matches.length
          return { ...state, active }
        }
        if (tr.docChanged && state.query !== '') {
          // Recompute rather than remap: an edit can create or destroy matches,
          // not just move them.
          const matches = findMatches(newState, state.query)
          return {
            query: state.query,
            matches,
            active: matches.length === 0 ? -1 : Math.min(Math.max(state.active, 0), matches.length - 1),
          }
        }
        return state
      },
    },
    props: {
      decorations(state) {
        const find = findKey.getState(state)
        if (find === undefined || find.matches.length === 0) return DecorationSet.empty
        return DecorationSet.create(
          state.doc,
          find.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class: index === find.active ? 'sm-find-match sm-find-active' : 'sm-find-match',
            }),
          ),
        )
      },
    },
  })
}

/** The milkdown wrapper the editor adapter mounts. */
export const findPlugin = $prose(() => findProsePlugin())
