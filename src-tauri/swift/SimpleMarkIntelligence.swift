// Apple Foundation Models, reachable from Rust.
//
// Three C functions and nothing else. FoundationModels is Swift-only — it has
// no Objective-C surface, so `objc2` (which every other native bridge in this
// crate uses) cannot reach it at any price. Hence one Swift compilation unit,
// linked as a static library by build.rs.
//
// Compiled only for macOS on Apple silicon. Apple Intelligence requires Apple
// silicon, so excluding Intel is honest rather than a workaround — and it
// leaves the x86_64 CI leg building exactly as it does today.
//
// Nothing here may trap across the FFI boundary. Every failure returns false
// or a null pointer; a model that cannot answer must never take down the app.

import Foundation
import FoundationModels

/// The prompt shape the spike arrived at after three passes.
///
/// Two properties are load-bearing and were each fixed by measurement:
///
///  - Fields generate in order, so `keySentence` and `ordering` act as a
///    scratchpad the model must fill before committing to a subtitle.
///  - `ordering` exists solely to stop thesis inversion. Documents arguing
///    "X before Y" came back backwards in both earlier passes — an ADR saying
///    *local session before any CRDT* was summarized as "a distributed
///    collaboration system". Naming both sides fixed every such case.
///
/// Every instruction is positive. The model reliably ignored prohibitions:
/// "never begin with 'This document'" was violated in 7 of 12 documents.
@available(macOS 26, *)
@Generable
struct NoteSubtitle {
    @Guide(description: "Copy, word for word, the one sentence from the document that best states its main point. Copy it exactly; do not rewrite it.")
    var keySentence: String

    @Guide(description: "If the document argues for doing one thing BEFORE, INSTEAD OF, or RATHER THAN another, name both sides in the form 'X before Y' or 'X instead of Y'. If it makes no such argument, write exactly: none")
    var ordering: String

    @Guide(description: "Two sentences for a note-list subtitle. The first says what the document is about; the second adds the most important specific detail, decision, or caveat in it. At most 30 words total. Begin with a verb or a concrete noun, never with the title. If ordering is not 'none', preserve that direction.")
    var subtitle: String
}

private let instructions = """
You write the grey subtitle line under a note title in a note list, the way \
Mail shows a preview under a subject.

Work from the document you are given. Ground every field in its actual words. \
Prefer the specific over the general: name the mechanism, the decision, or the \
constraint the document commits to.
"""

/// Whether a summary can be produced right now.
///
/// Apple requires a runtime availability check — the framework being present
/// says nothing about whether Apple Intelligence is enabled, downloaded, or
/// supported on this machine.
@_cdecl("simplemark_intelligence_available")
public func simplemark_intelligence_available() -> Bool {
    guard #available(macOS 26, *) else { return false }
    if case .available = SystemLanguageModel.default.availability { return true }
    return false
}

/// Summarizes one distilled document. Returns a malloc'd C string the caller
/// must pass to `simplemark_intelligence_free`, or null on any failure.
///
/// Synchronous by design. Apple's generation is async, but the Rust side calls
/// this from a worker that already serializes to one note at a time, so the
/// semaphore blocks a thread that has nothing else to do rather than the UI.
@_cdecl("simplemark_intelligence_summarize")
public func simplemark_intelligence_summarize(
    _ input: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 26, *), let input else { return nil }
    let prompt = String(cString: input)
    guard !prompt.isEmpty else { return nil }

    let semaphore = DispatchSemaphore(value: 0)
    // `nonisolated(unsafe)` is sound here: exactly one task writes it, and the
    // semaphore establishes the happens-before edge before it is read.
    nonisolated(unsafe) var produced: String?

    Task {
        defer { semaphore.signal() }
        do {
            // A fresh session per note. A reused session accumulates every
            // prior document in its transcript and exhausts the context window.
            let session = LanguageModelSession(instructions: instructions)
            let response = try await session.respond(
                to: prompt,
                generating: NoteSubtitle.self,
                options: GenerationOptions(temperature: 0.0)
            )
            let subtitle = response.content.subtitle
                .trimmingCharacters(in: .whitespacesAndNewlines)
            produced = subtitle.isEmpty ? nil : subtitle
        } catch {
            // Declined, over budget, guardrail-tripped: all the same outcome.
            // The row keeps its extracted preview.
            produced = nil
        }
    }

    // Generous, and not a latency target: measured cold summaries ran 0.9–2.1s.
    // This exists so a wedged model cannot hold the worker thread forever.
    guard semaphore.wait(timeout: .now() + 20) == .success,
          let produced else { return nil }

    return strdup(produced)
}

/// Frees a string returned by `simplemark_intelligence_summarize`.
@_cdecl("simplemark_intelligence_free")
public func simplemark_intelligence_free(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}
