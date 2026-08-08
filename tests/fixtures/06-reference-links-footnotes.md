# Reference-style links and footnotes

The definitions below are deliberately scattered. A serializer that collects
them at the end of the document has rewritten content the author placed
on purpose.

See the [Peritext research][peritext] for why Markdown source characters are
not the user's formatting intent.[^intent]

[peritext]: https://www.inkandswitch.com/peritext/ "Peritext: A CRDT for Rich-Text Collaboration"

More prose between two definitions.

[^intent]: Concurrent edits to formatting delimiters can preserve valid text
    while losing both authors' intent. The continuation line is indented four
    spaces and must stay that way.

A [collapsed reference][] and a [shortcut reference] both resolve by label.

[collapsed reference]: https://marijnhaverbeke.nl/blog/collaborative-editing.html
[shortcut reference]: https://prosemirror.net/

An inline footnote reference appears mid-sentence[^2] and its definition sits
immediately after the paragraph rather than at the end of the file.

[^2]: Placed close to its reference on purpose.

[unused]: https://example.invalid/never-referenced

A final paragraph after an unused definition that must survive anyway.
