# Mermaid sample

A sample for the Markdown viewer's Mermaid diagrams (spec 012).

## Flowchart

```mermaid
flowchart LR
  edit[Edit in the repo] --> install[./install.sh]
  install --> check{herdr-app check}
  check -->|passes| window[Look in the window]
  check -->|fails| edit
```

## Sequence

```mermaid
sequenceDiagram
  participant V as Viewer
  participant M as mmdc
  V->>M: diagram source
  M-->>V: PNG in the cache
  V->>V: draw it in place
```

## Broken

This one has an error, so its code shows, with Mermaid's message under it.

```mermaid
flowchart LR
  A -->
```

## Ordinary code

```js
const stays = "code";
```
