import { SAMPLE_DOCUMENTS } from './sample-documents.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'

export type SampleWorkspaceActions = Pick<WorkspaceOptions, 'onSelectNote'> &
  Partial<Pick<WorkspaceOptions, 'onCreateNote' | 'onAddFolder' | 'onSelectCollection' | 'folders'>>

/** The native welcome state: two real sample documents, never a synthetic placeholder. */
export function sampleWorkspaceOptions(
  activeNoteId: string,
  actions: SampleWorkspaceActions,
): WorkspaceOptions {
  return {
    name: 'SimpleMark',
    collectionLabel: 'Samples',
    activeCollectionId: 'recent',
    activeNoteId,
    recentNotesCount: 0,
    ...actions,
    notes: SAMPLE_DOCUMENTS.map((sample) => ({
      id: sample.id,
      identifier: sample.name,
      portableLink: `./${sample.name}`,
      title: sample.title,
      preview: sample.preview,
      updatedLabel: sample.updatedLabel,
      pinned: sample.pinned,
    })),
  }
}
