# Hostile Markdown, on purpose

**Nested tables, inline links inside cells, anchors, and mixed list markers in one file.**

- **Status:** Fixture
- **Purpose:** byte-level round-trip pressure
- **Companion to:** [`COLLABORATION.md`](COLLABORATION.md)

<a id="verdict"></a>

## 1. The shapes that break serializers

| Take | From | Why |
|---|---|---|
| **Inline links in cells** | [the anchor above](#verdict) | Cell content is parsed, not copied |
| **Ragged pipes** | rows below | Column padding is a rewrite, not a read |
| **Mixed markers** | the list under §2 | `-` and `*` both mean bullet, only one survives |
| **Reference definitions** | the bottom of this file | They live outside the block that uses them |

| Ragged | Table |
|---|---|
| a | b |
|  longer cell   | x |
| `code | pipe` | done |

<a id="the-fence"></a>

## 2. Mixed list markers, deliberately inconsistent

- first, with a hyphen
* second, with an asterisk
+ third, with a plus
- fourth, back to a hyphen
  1. nested ordered
  2) nested ordered, other delimiter

## 3. Escapes that a naive round-trip will mangle

A literal asterisk \* and a literal underscore \_ and a literal bracket \[ .

Text with trailing spaces for a hard break  
lands on the next line.

Setext heading
==============

Another one
-----------

## 4. Reference links, defined far from use

This paragraph uses [a reference][ref-one] and [another][ref-two], both defined
at the bottom. Serializing this block in isolation loses the definitions.

***

Horizontal rules come in three spellings and only one survives a naive rewrite.

---

___

[ref-one]: https://example.com/one "First"
[ref-two]: https://example.com/two "Second"
