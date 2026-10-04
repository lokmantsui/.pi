---
name: gps
description: Explore a codebase or package and produce a D2 architecture diagram where every node links to its definition (vscode://file/<abs-path>:<line>). Use when asked to diagram, visualize, or explain how a package/module/system works with d2.
---

# D2 architecture diagram with source links

Goal: one `.d2` file that explains how the code works, compiles cleanly, renders readably, and has a clickable `link` on every node pointing to the exact definition line.

Scripts are relative to this skill directory.

## 1. Clarify scope

If the target is ambiguous (monorepo root, several packages), ask which package/module to diagram before exploring. Ask where to write the file if unclear; default `<package>/architecture.d2`.

## 2. Explore

Follow the real control flow, not the folder layout:

1. Find entry points (`package.json` `bin`/`main`/`exports`, `cli.ts`, `main.ts`, `index.ts`).
2. Read the main entry function fully. Note startup phases, mode/command dispatch.
3. Identify the core objects (largest/most-imported classes), their constructors, and the main public methods (e.g. `prompt()`, `run()`, `handle()`).
4. Trace one representative request end to end (user input -> core -> external IO -> back). This becomes the numbered flow.
5. Identify extension points, persistence (files, DBs), external services, and cross-package dependencies.

Useful commands: `find src -type f | xargs wc -l | sort -n | tail -80`, `grep -n "^export\|^import" file`, `grep -nE "^\s+(async )?(private )?[a-zA-Z_]+\(.*\).*\{$" file`.

## 3. Write the diagram

Structure:

- `direction: down`, a markdown `title` with `near: top-center`.
- Containers per subsystem (entry, modes/adapters, runtime/services, core, external libs, extensions, storage).
- Inside containers, nodes for the key classes/functions with short multi-line labels (`"Name\nwhat it does"`).
- Startup/wiring edges in default style.
- One numbered request flow (`1. ...`, `2. ...`) highlighted with a `flow` class; hooks/registrations dashed with a `hook` class.
- Header comment explaining the render command, edge conventions, and that nodes link to source.

Template:

```d2
# <pkg> architecture
# Render: d2 --layout elk <file>.d2 <file>.svg
# Solid numbered edges (1-N) trace one request. Dashed edges are hooks/registrations.
# Every node links to its definition (vscode://file/...:line); clickable in SVG output.

vars: {
  src: vscode://file/ABS/PATH/TO/pkg/src
}

direction: down

title: |md
  # pkg-name
  one-line summary
| {near: top-center}

classes: {
  hook: {style.stroke-dash: 3}
  flow: {style: {stroke: "#d6336c"; stroke-width: 3; font-color: "#d6336c"; bold: true}}
}

core: "Core (src/core/thing.ts)" {
  link: "${src}/core/thing.ts:42"
  run: "run(input)\n\nvalidates\ndispatches" {
    link: "${src}/core/thing.ts:120"
  }
}

user -> core.run: "1. call" {class: flow}
```

## 4. Add links to every node

- Every node and container gets `link: "${var}/rel/path.ts:<line>"`. Use `vars` for absolute path prefixes (one var per package/root).
- Line = the definition line (`export class X`, `export function x`, method signature), not an import or call site. Containers link to the main class/entry of that subsystem; files without a single definition link to `:1`.
- Get lines with grep, never guess: `grep -n -m1 'export class AgentSession ' path` or `grep -n 'async prompt(' path`. Verify ambiguous hits with `sed -n '<line>p' path`.
- Leaf nodes in a bare form (`read`) must become `read: {link: "..."}`.
- Skip nodes that do not exist in code (person, external cloud API, title).
- Edges cannot have links.
- Use `tooltip` only if the user asks for hover text.
- If the user wants portable links instead, use GitHub URLs pinned to a commit: `https://github.com/<org>/<repo>/blob/<sha>/<path>#L<line>`.

## 5. Compile, check, look

```bash
D2=$(./scripts/ensure-d2.sh)            # prints path to a d2 binary (system or /tmp download)
$D2 --layout elk file.d2 /tmp/diagram.svg
node ./scripts/check-links.mjs /tmp/diagram.svg   # verifies every vscode:// link: file exists, line in range
```

Then `read` the PNG and check readability. If edges cross the whole diagram, aggregate them (connect container -> container instead of node -> node), drop low-value edges, or move nodes between containers. Iterate until it is readable.

## D2 gotchas (all hit in practice)

- Unquoted labels containing `->`, `(`, `:` break parsing. Quote every label: `entry: "Entry: a.ts -> b.ts" {`.
- Keys containing `.` create nesting. Use short keys plus labels: `cli: "cli.ts"`.
- `$` starts a variable substitution, even in quoted strings. Don't write `$CWD`; use `<cwd>` in plain labels.
- `|md ... |` blocks end at the first `|`. Don't use `|` inside them. `<word>` in markdown is parsed as HTML and fails. Use backticks or avoid it.
- Markdown nodes render as unboxed text and collapse single newlines. Prefer plain quoted labels with `\n` for boxed nodes; use markdown only for the title.
- Links work only in SVG. PNG/PDF drop them. d2 adds a small link icon to linked shapes.
- Prefer `--layout elk` for nested containers; dagre gets messy.

## 6. Report

Tell the user the file path, the render command, the SVG/PNG preview paths, a short walkthrough of the numbered flow, and that line numbers drift as code changes (re-run step 4 to refresh).
