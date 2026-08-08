# Fence styles that must not be normalised

A tilde fence:

~~~
plain tilde fence, no language
~~~

A tilde fence with a language and extra tildes:

~~~~~python
def parse(source: str) -> str:
    return source  # ~~~ inside a longer tilde fence
~~~~~

A four-backtick fence containing a three-backtick fence:

````markdown
```js
console.log('a nested fence inside a longer one')
```
````

A five-backtick fence containing a four-backtick fence containing a three:

`````text
````markdown
```sh
echo deep
```
````
`````

An indented code block, which is a different construct entirely:

    indented four spaces
    still indented

A fence with an info string carrying attributes:

```ts title="ports.ts" {2,4-6}
export interface FilePort {
  read(): Promise<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
}
```

A fence that is never closed is a real document state and must round-trip:

```json
{ "unterminated": true }
