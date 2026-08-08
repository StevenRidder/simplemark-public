# Tables with ragged padding and alignment rows

A minimal table with no padding at all:

|a|b|c|
|-|-|-|
|1|2|3|

A table with wildly inconsistent padding that must not be repadded:

| Column one |Column two|      Column three |
|---|:---:|----------:|
| short |   centred value    |42|
|a much longer cell than the header|x|   7 |

Every alignment marker in one table:

| left | centre | right | default |
|:-----|:------:|------:|---------|
| l    |   c    |     r | d       |

Inline structure inside cells:

| Take | From | Why |
|---|---|---|
| **The fence** | `domain/execution_liveness.py` | [Reliable interruption](#fence) |
| Exactly-once | `storage/external_effects.py` | Must not insert it twice |
| Pipe in code | `` a \| b `` | An escaped pipe and a code span |

A table immediately followed by a paragraph with no blank line between:

| k | v |
|---|---|
| a | 1 |
trailing paragraph glued to the table
