import type { ModelListTransport } from '../../adapters/ai/openai-compatible-diagram-fix.js'
import { listModels } from '../../adapters/ai/openai-compatible-diagram-fix.js'
import { loadAiSettings, normaliseAiSettings, saveAiSettings } from '../ai-settings.js'

export interface SettingsPanel {
  readonly element: HTMLElement
  open(): void
  close(): void
  toggle(): void
}

export interface SettingsPanelOptions {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  /** Backs the "Load models" button next to the Model field. */
  readonly listModels: ModelListTransport
}

function field(label: string, type: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('label')
  row.className = 'settings-field'
  const name = document.createElement('span')
  name.className = 'settings-field-label'
  name.textContent = label
  const input = document.createElement('input')
  input.type = type
  input.placeholder = placeholder
  input.spellcheck = false
  input.autocomplete = 'off'
  row.append(name, input)
  return { row, input }
}

/**
 * The app's one Settings surface today: the AI diagram fix-it credentials.
 *
 * A centred overlay rather than the "Aa" popover's floating-aside style —
 * this is a form the user fills in once, not something read while editing,
 * so it earns the modal attention a popover deliberately avoids.
 */
export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanel {
  const overlay = document.createElement('div')
  overlay.className = 'settings-overlay'
  overlay.hidden = true

  const panel = document.createElement('section')
  panel.className = 'settings-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Settings')

  const header = document.createElement('header')
  header.className = 'settings-header'
  const title = document.createElement('span')
  title.className = 'settings-title'
  title.textContent = 'Settings'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'settings-close'
  close.textContent = '✕'
  close.title = 'Close (Esc)'
  close.setAttribute('aria-label', 'Close settings')
  close.addEventListener('click', (event) => {
    event.preventDefault()
    closePanel()
  })
  header.append(title, close)

  const body = document.createElement('div')
  body.className = 'settings-body'

  const sectionTitle = document.createElement('h3')
  sectionTitle.textContent = 'AI diagram fix'
  const sectionHint = document.createElement('p')
  sectionHint.className = 'settings-hint'
  sectionHint.textContent =
    'Used by the "Fix it" button on a broken diagram. Stored locally on this device, not encrypted.'

  const apiKeyField = field('API key', 'password', 'sk-…')
  const baseUrlField = field('Base URL', 'text', 'https://api.openai.com/v1')
  const modelField = field('Model', 'text', 'e.g. gpt-4o')

  const loadModelsRow = document.createElement('div')
  loadModelsRow.className = 'settings-load-models-row'
  const loadModelsButton = document.createElement('button')
  loadModelsButton.type = 'button'
  loadModelsButton.className = 'settings-load-models'
  loadModelsButton.textContent = 'Load models'
  loadModelsRow.append(loadModelsButton)

  const modelSelect = document.createElement('select')
  modelSelect.className = 'settings-model-select'
  modelSelect.hidden = true
  modelSelect.setAttribute('aria-label', 'Pick a model')

  const modelError = document.createElement('p')
  modelError.className = 'settings-model-error'
  modelError.hidden = true

  function refreshLoadModelsAvailability(): void {
    loadModelsButton.disabled =
      apiKeyField.input.value.trim() === '' || baseUrlField.input.value.trim() === ''
  }
  apiKeyField.input.addEventListener('input', refreshLoadModelsAvailability)
  baseUrlField.input.addEventListener('input', refreshLoadModelsAvailability)

  async function handleLoadModels(): Promise<void> {
    const effective = normaliseAiSettings({
      apiKey: apiKeyField.input.value,
      baseUrl: baseUrlField.input.value,
    })
    modelError.hidden = true
    modelSelect.hidden = true
    loadModelsButton.disabled = true
    loadModelsButton.textContent = 'Loading…'
    const result = await listModels(options.listModels, effective.baseUrl, effective.apiKey)
    loadModelsButton.textContent = 'Load models'
    refreshLoadModelsAvailability()

    if (!result.ok) {
      modelError.textContent = `Couldn't load models — ${result.message}. You can still type one.`
      modelError.hidden = false
      return
    }
    modelSelect.replaceChildren()
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = `Pick from ${result.models.length} model${result.models.length === 1 ? '' : 's'}…`
    placeholder.disabled = true
    placeholder.selected = true
    modelSelect.append(placeholder, ...result.models.map((id) => {
      const option = document.createElement('option')
      option.value = id
      option.textContent = id
      return option
    }))
    modelSelect.hidden = false
  }
  loadModelsButton.addEventListener('click', (event) => {
    event.preventDefault()
    void handleLoadModels()
  })
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value !== '') modelField.input.value = modelSelect.value
  })

  const actions = document.createElement('div')
  actions.className = 'settings-actions'
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'settings-save'
  save.textContent = 'Save'
  save.addEventListener('click', (event) => {
    event.preventDefault()
    const next = normaliseAiSettings({
      apiKey: apiKeyField.input.value,
      baseUrl: baseUrlField.input.value,
      model: modelField.input.value,
    })
    saveAiSettings(options.storage, next)
    closePanel()
  })
  actions.append(save)

  body.append(
    sectionTitle,
    sectionHint,
    apiKeyField.row,
    baseUrlField.row,
    modelField.row,
    loadModelsRow,
    modelSelect,
    modelError,
    actions,
  )
  panel.append(header, body)
  overlay.append(panel)

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closePanel()
  })

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closePanel()
  }

  function paint(): void {
    const current = loadAiSettings(options.storage)
    apiKeyField.input.value = current.apiKey
    baseUrlField.input.value = current.baseUrl
    modelField.input.value = current.model
    modelSelect.hidden = true
    modelSelect.replaceChildren()
    modelError.hidden = true
    loadModelsButton.textContent = 'Load models'
    refreshLoadModelsAvailability()
  }

  function openPanel(): void {
    paint()
    overlay.hidden = false
    document.addEventListener('keydown', onEscape)
    apiKeyField.input.focus()
  }

  function closePanel(): void {
    overlay.hidden = true
    document.removeEventListener('keydown', onEscape)
  }

  return {
    element: overlay,
    open: openPanel,
    close: closePanel,
    toggle: () => (overlay.hidden ? openPanel() : closePanel()),
  }
}
