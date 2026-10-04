---
name: gps
description: Explore a codebase or package and produce a D2 architecture diagram where every node links to its definition (vscode://file/<abs-path>:<line>), then trace verified, reusable A -> B paths drawn in color over that map. Use when asked to diagram, visualize, or explain how a package/module/system works with d2, or how data/control flows from one code location to another (args `from:<loc>` / `to:<loc>`).
---

# D2 architecture diagram with source links

Two modes:

- **Map** (no `from:`/`to:` args): one `.d2` file (`pkg/architecture.gps/map.d2`, rendered to `map.svg` next to it) that explains how the code works, compiles cleanly, renders readably, and has a clickable `link` on every node pointing to the exact definition line. Steps 1-6.
- **Path** (`from:<loc>` and/or `to:<loc>`): trace how data/control gets from A to B, verify it mechanically, save it next to the map, and draw it as a green path over the map. See "Path mode" below.

Scripts are relative to this skill directory.

## 1. Clarify scope

If the target is ambiguous (monorepo root, several packages), ask which package/module to diagram before exploring. Ask where to write the file if unclear; default `<package>/architecture.gps/map.d2`. The `<name>.gps/` dir holds the map (`map.d2` + `map.svg`, name fixed so scripts find it) and all saved paths; `map` is reserved and never used as a trace slug.

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
# Render: d2 --layout elk map.d2 map.svg
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
$D2 --layout elk pkg/architecture.gps/map.d2 pkg/architecture.gps/map.svg
node ./scripts/check-links.mjs pkg/architecture.gps/map.svg   # verifies every vscode:// link: file exists, line in range
$D2 --layout elk pkg/architecture.gps/map.d2 /tmp/map.png     # preview only; do not save the PNG
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

Tell the user the map path (`pkg/architecture.gps/map.d2`), the render command, the SVG path (`map.svg`) and PNG preview path, a short walkthrough of the numbered flow, and that line numbers drift as code changes (re-run step 4 to refresh).

# Path mode

A path is a list of hops from A to B. Each hop is one code location plus the exact source text that passes the value on. It is saved as JSON next to the map, so future agents reuse it instead of re-tracing. The map itself is never redrawn; the path is a separate `.d2` that imports the map and colors it.

Files, for map `pkg/architecture.gps/map.d2`:

```
pkg/architecture.gps/map.d2         the map (map mode output)
pkg/architecture.gps/map.svg        the map, rendered, clickable
pkg/architecture.gps/index.md       one table of all saved paths (read this first; cheap)
pkg/architecture.gps/<slug>.json    trace record (source of truth)
pkg/architecture.gps/<slug>.d2      generated overlay: ...@map + green path
pkg/architecture.gps/<slug>.svg     rendered, clickable
```

## Locations

`<loc>` may be any of:

- `vscode selection` / `vscode cursor`: call the `vscode_context` tool and use the active file + selected lines. If that tool is missing, ask the user for a path:line.
- `https://vscode.dev/github/<org>/<repo>/blob/<ref>/<path>#L508-L510` or the same `github.com` URL (mapped onto the local git checkout).
- `vscode://file/<abs>:<line>`, `<path>:<line>[-<end>]`, `<path>#L<line>`.

Resolve each with:

```bash
node ./scripts/resolve-loc.mjs '<loc>' [--map pkg/architecture.gps/map.d2]
```

It prints the source lines, the map nodes in that file (nearest definition marked `*`), and every saved trace that already passes through that location.

## Flow

1. **Find the map.** Use the one from earlier in this conversation, else the map `resolve-loc.mjs` lists. If there is none, offer to build one first (map mode); a path needs a map.
2. **`from:` only.** Resolve A. Read `index.md` and list saved paths that start at or pass through A (from `resolve-loc.mjs`) as ready-made destinations. Then ask the user for the destination B. Keep A in the conversation; the next invocation may be `to:` only.
3. **`to:` given** (with A from args or earlier in the conversation; if A is unknown, ask for it). Resolve B. Also ask for or infer a one-line intent (which value or event the user cares about).
4. **Reuse first.** If `index.md` has a trace with the same A and B (same symbols; lines may differ a little), run `verify-trace.mjs` on it:
   - `VERIFIED`: reuse it. Go to step 7.
   - `DRIFTED`: lines shifted but bodies unchanged. Run `verify-trace.mjs <json> --fix`, then step 7. No re-tracing.
   - `STALE`: re-trace only the hops reported STALE/BAD, keeping the rest.
5. **Trace.** Start at A, find where the value goes next (call argument, return, assignment, emit/callback, subscription), follow it into the next function, repeat until B. Prefer the shortest real path. Read the code; never guess a hop. When a hop goes through dynamic dispatch, a callback registry, or a subscription, find the registration site, name it in the edge label, and add a `gaps` entry for alternatives you did not take (e.g. the parallel branch).
6. **Write `pkg/architecture.gps/<slug>.json`** (schema below), then stamp and verify:
   ```bash
   node ./scripts/verify-trace.mjs pkg/architecture.gps/<slug>.json --stamp
   ```
   Fix any BAD hop (wrong line or `via` not copied verbatim) and rerun until `VERIFIED`.
7. **Render.**
   ```bash
   node ./scripts/render-path.mjs pkg/architecture.gps/<slug>.json
   ```
   This checks node keys exist in the map, writes `<slug>.d2` + `<slug>.svg`, checks links, rewrites `index.md`, and adds a one-line pointer to `index.md` in the map header (once). Then render a PNG of `<slug>.d2` and `read` it to check the path is readable. If hops pile into one cramped container, merge minor hops (keep them in the JSON, but give them the same `node`; consecutive hops with the same key draw one node).
8. **Report** the answer (the `summary`), the numbered hops with `file:line`, the gaps, and the SVG path.

## Trace JSON schema

```json
{
  "map": "map.d2",
  "root": "/abs/git/root",
  "commit": "<git rev-parse --short HEAD>",
  "traced_at": "<ISO time>",
  "query": {"from": "<repo-rel path>:<line>", "to": "<repo-rel path>:<line>[-<end>]", "intent": "one line"},
  "summary": "Plain-language answer a future agent can quote without reading code.",
  "hops": [
    {
      "step": 1,
      "file": "packages/agent/src/agent-loop.ts",
      "line": 520,
      "range": [508, 523],
      "symbol": "executeToolCalls",
      "via": "return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);",
      "carries": "tool calls + emit sink",
      "node": "agent.exec",
      "edge": "label of the edge to the next hop"
    },
    {
      "step": 2, "file": "...", "line": 569, "range": [530, 584], "symbol": "executeToolCallsSequential",
      "via": "await emitToolExecutionEnd(finalized, emit);", "carries": "...",
      "container": "agent", "label": "executeToolCallsSequential\nper tool: prepare, execute, finalize", "edge": "..."
    }
  ],
  "gaps": ["assumptions and branches not taken"]
}
```

Rules:

- `line`: the line holding `via`. `via`: an exact substring of that line, copied verbatim (the verifier checks it; this is what stops invented hops). For the last hop, `via` is the text at B.
- `range`: first and last line of the enclosing function/method. The verifier hashes it (`sha`, added by `--stamp`) to detect code changes.
- `node`: an existing map node key (from `resolve-loc.mjs` output) when the hop is that node's code. Otherwise omit `node`, set `container` to the map container it belongs in (or omit for top level), and give a short `label` (`"name\nwhat it does"`). New nodes link to `file:line` automatically.
- `edge`: short label for the edge to the next hop. Omit on the last hop.
- Slug: short kebab-case from the intent, e.g. `tool-execution-end-to-extensions`. Never `map` (reserved for the map file).
- The JSON is the source of truth. Never hand-edit `<slug>.d2`; edit the JSON and rerun `render-path.mjs`.

## Exit codes

- `verify-trace.mjs`: 0 VERIFIED, 1 DRIFTED, 2 STALE/BAD.
- `render-path.mjs`: 1 on unknown node/container keys or bad links.
