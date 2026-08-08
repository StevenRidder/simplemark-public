import type { AppIconChoice, AppIconId } from '../app-icons.js'

export interface AppIconSettingsOptions {
  readonly choices: readonly AppIconChoice[]
  readonly selected: AppIconId
  readonly onChange: (icon: AppIconId) => Promise<void>
  readonly onError: (error: unknown) => void
}

export function createAppIconSettings(options: AppIconSettingsOptions): HTMLElement {
  const section = document.createElement('section')
  section.className = 'app-icon-settings'

  const heading = document.createElement('h2')
  heading.textContent = 'App Icon'

  const choices = document.createElement('div')
  choices.className = 'app-icon-choices'
  let selected = options.selected
  let pending = false

  const buttons = options.choices.map((choice) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'app-icon-choice'
    button.dataset['icon'] = choice.id
    button.setAttribute('aria-label', `Use ${choice.label} app icon`)
    button.title = choice.label

    const thumbnail = document.createElement('img')
    thumbnail.src = choice.source
    thumbnail.alt = ''
    thumbnail.draggable = false
    thumbnail.setAttribute('aria-hidden', 'true')

    const check = document.createElement('span')
    check.className = 'app-icon-check'
    check.setAttribute('aria-hidden', 'true')
    check.textContent = '✓'
    button.append(thumbnail, check)
    choices.append(button)
    return button
  })

  const paint = (): void => {
    for (const button of buttons) {
      const active = button.dataset['icon'] === selected
      button.classList.toggle('selected', active)
      button.setAttribute('aria-pressed', String(active))
      button.disabled = pending
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const icon = button.dataset['icon'] as AppIconId
      if (pending || icon === selected) return
      pending = true
      paint()
      void options.onChange(icon).then(() => {
        selected = icon
      }).catch(options.onError).finally(() => {
        pending = false
        paint()
      })
    })
  }

  paint()
  section.append(heading, choices)
  return section
}
