/**
 * The in-document find overlay (EDITOR-7).
 *
 * A temporary control that floats over the editor section — deliberately not a
 * panel, not a titlebar item, and gone without residue on Escape. Presentation
 * only: match state lives in the editor's find plugin, and this bar just
 * reports intent and paints the count it is handed back.
 */

export interface FindBarOptions {
  /** Runs the query; empty string clears. Returns the new match state. */
  readonly onQuery: (query: string) => { count: number; active: number }
  /** Steps the active match. Returns the new match state. */
  readonly onStep: (direction: 1 | -1) => { count: number; active: number }
}

export interface FindBar {
  readonly element: HTMLElement
  open(): void
  close(): void
  isOpen(): boolean
}

export function createFindBar(options: FindBarOptions): FindBar {
  const bar = document.createElement('div')
  bar.className = 'find-bar'
  bar.setAttribute('role', 'search')
  bar.setAttribute('aria-label', 'Find in document')

  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Find in document'
  input.setAttribute('aria-label', 'Find text')

  const count = document.createElement('span')
  count.className = 'find-count'

  const paint = (state: { count: number; active: number }): void => {
    if (input.value === '') {
      count.textContent = ''
      return
    }
    count.textContent = state.count === 0 ? 'No matches' : `${state.active + 1} of ${state.count}`
  }

  const step = (direction: 1 | -1): void => paint(options.onStep(direction))

  const navButton = (label: string, icon: string, direction: 1 | -1): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`
    // mousedown so the input keeps focus while stepping through matches.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      step(direction)
    })
    return button
  }

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Close find')
  closeButton.title = 'Close find'
  closeButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  closeButton.addEventListener('click', () => close())

  input.addEventListener('input', () => paint(options.onQuery(input.value)))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  bar.append(
    input,
    count,
    navButton('Previous match', '<path d="m18 15-6-6-6 6"/>', -1),
    navButton('Next match', '<path d="m6 9 6 6 6-6"/>', 1),
    closeButton,
  )

  const open = (): void => {
    bar.classList.add('open')
    input.focus()
    input.select()
    if (input.value !== '') paint(options.onQuery(input.value))
  }

  const close = (): void => {
    bar.classList.remove('open')
    input.value = ''
    count.textContent = ''
    // Clearing the query removes every match decoration — closed means gone.
    options.onQuery('')
  }

  return {
    element: bar,
    open,
    close,
    isOpen: () => bar.classList.contains('open'),
  }
}
