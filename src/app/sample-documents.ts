import projectTanoaMarkdown from '../../docs/showcase/project-tanoa-storm-atlas.md?raw'
import welcomeMarkdown from '../../docs/showcase/welcome-to-simplemark.md?raw'

export interface SampleDocument {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly preview: string
  readonly markdown: string
  readonly updatedLabel: 'Sample'
  readonly modifiedHoursAgo: number
  readonly createdHoursAgo: number
  readonly pinned: boolean
}

export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  {
    id: 'welcome-to-simplemark',
    name: 'welcome-to-simplemark.md',
    title: 'Welcome to SimpleMark',
    preview: 'A ten-minute tour of every living-document capability.',
    markdown: welcomeMarkdown,
    updatedLabel: 'Sample',
    modifiedHoursAgo: 0,
    createdHoursAgo: 52,
    pinned: true,
  },
  {
    id: 'project-tanoa-storm-atlas',
    name: 'project-tanoa-storm-atlas.md',
    title: 'Project Tanoa: Storm Atlas',
    preview: 'A community microgrid enters island mode before the storm.',
    markdown: projectTanoaMarkdown,
    updatedLabel: 'Sample',
    modifiedHoursAgo: 3,
    createdHoursAgo: 6,
    pinned: false,
  },
]

export const WELCOME_SAMPLE = SAMPLE_DOCUMENTS[0]!

export function sampleDocument(id: string): SampleDocument | undefined {
  return SAMPLE_DOCUMENTS.find((sample) => sample.id === id)
}
