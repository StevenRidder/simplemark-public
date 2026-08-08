/**
 * Public entry point for `domain` — pure document, source, transaction, and
 * fence rules. Imports no SimpleMark module and no framework, DOM, Tauri,
 * CRDT, MCP, or filesystem API.
 *
 * Transactions and fences join this surface with the live-agent deliverable;
 * source baselines and dirty-block serialization with FIDELITY-1.
 */
export { TABLE_CELL_BUDGET, planTableRendering } from './render/table-budget.js'
export type { TableRenderPlan } from './render/table-budget.js'
export { firstByteDifference } from './source/byte-diff.js'
export { buildSourceMap, emitDocument } from './source/source-map.js'
export { parseFenceLayout, withFenceMetaKey } from './source/fence-meta.js'
export { suggestedMarkdownFileName } from './document-title.js'
export {
  MERMAID_SIGNATURE,
  isStandaloneBlockPaste,
  looksLikeMermaid,
  looksLikeSvg,
  svgInHtml,
  svgToCodeFenceHtml,
} from './paste/recognition.js'
export type { ByteDifference } from './source/byte-diff.js'
export type { SourceBlock, SourceMap } from './source/source-map.js'
export type { FenceLayout } from './source/fence-meta.js'
export type { PasteCandidate } from './paste/recognition.js'
export {
  DEFAULT_LIVE_TABLE_CELL_BUDGET,
  planTableDeferral,
} from './render/table-deferral.js'
export type { MarkdownTableSpan, TableDeferralPlan } from './render/table-deferral.js'
export {
  htmlCarriesDocumentStructure,
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeJson,
  looksLikeStackTrace,
  looksLikeTsv,
  tsvToMarkdownTable,
} from './paste/exhaust.js'
export {
  looksLikeDot,
  looksLikeMath,
  looksLikeVegaLite,
  stripMathDelimiters,
} from './paste/formal.js'
export { CALLOUT_TYPES, matchCalloutMarker } from './paste/callout.js'
export type { CalloutMarker, CalloutType } from './paste/callout.js'
export { isPortableAssetReference, isRemoteImageSource } from './paste/images.js'
export { analysePastedPage } from './paste/page.js'
export type { PageAnalysis, PageNode } from './paste/page.js'
export { provenanceHtml, readPasteProvenance } from './paste/provenance.js'
export type { PasteProvenance } from './paste/provenance.js'
export {
  codeFenceContent,
  markdownTableToCsv,
  markdownTableToHtml,
  markdownToPlainText,
} from './clipboard/formats.js'
export { CONTEXT_LENGTH, buildAnchor, matchAnchor } from './notes/anchor.js'
export type { Anchor } from './notes/anchor.js'
