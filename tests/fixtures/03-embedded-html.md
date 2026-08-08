# Embedded HTML must be preserved opaquely

Prose before the block.

<details>
<summary>Why the renderer never says no</summary>

Nested **Markdown** inside an HTML block is a genuine ambiguity. Whatever the
parser decides, the original bytes have to come back unchanged.

</details>

An inline <img src="attachments/9f3a2b.png" alt="ink sketch" width="320"> tag
sits mid-paragraph and must not be reflowed.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img">
  <title>A square</title>
  <rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor"/>
</svg>

<!-- simplemark:ink source=attachments/9f3a2b.strokes.json -->

<div align="center">
  <p>Raw HTML with <em>mixed</em> content and irregular
     indentation.</p>
</div>

Prose after the block.
