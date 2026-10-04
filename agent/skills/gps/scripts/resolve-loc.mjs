#!/usr/bin/env node
// Resolve a location (vscode.dev / github URL, vscode:// link, path:line) against a gps map.
// Prints: the source lines, the nearest map nodes in that file, and saved traces touching it.
// Usage: node resolve-loc.mjs <loc> [--map pkg/architecture.gps/map.d2]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gitRoot, listMaps, mapNodes, parseLoc, readLines, tracesDir } from "./lib.mjs";

const args = process.argv.slice(2);
const mapIdx = args.indexOf("--map");
const mapArg = mapIdx >= 0 ? args.splice(mapIdx, 2)[1] : undefined;
const loc = args[0];
if (!loc) {
	console.error("usage: resolve-loc.mjs <loc> [--map pkg/architecture.gps/map.d2]");
	process.exit(2);
}

const { file, start, end, repo } = parseLoc(loc);
if (!existsSync(file)) {
	console.error(`file not found: ${file}`);
	process.exit(1);
}
const root = gitRoot(file) ?? "/";
const rel = relative(root, file);
const lines = readLines(file);

console.log(`file: ${file}`);
console.log(`rel:  ${rel}${repo ? `  (from ${repo})` : ""}`);
console.log(`loc:  ${rel}:${start}${end !== start ? `-${end}` : ""}`);
for (let i = Math.max(1, start - 2); i <= Math.min(lines.length, end + 2); i++) {
	console.log(`${i >= start && i <= end ? ">" : " "} ${String(i).padStart(5)}| ${lines[i - 1]}`);
}

const maps = mapArg ? [mapArg] : listMaps(file);
if (maps.length === 0) {
	console.log("\nno gps map found in this repo");
	process.exit(0);
}
if (!mapArg) console.log(`\nmaps in repo: ${maps.map((m) => relative(process.cwd(), m)).join(", ")}`);

for (const map of maps) {
	console.log(`\n== map ${relative(process.cwd(), map)}`);
	const inFile = mapNodes(map)
		.filter((n) => n.file === file)
		.sort((a, b) => a.line - b.line);
	const before = inFile.filter((n) => n.line <= start);
	const nearest = before.at(-1);
	if (inFile.length === 0) console.log("nodes in this file: none (path will need a new node)");
	else {
		console.log("nodes in this file (* = nearest definition at or above loc):");
		for (const n of inFile) {
			const text = (lines[n.line - 1] ?? "").trim().slice(0, 70);
			console.log(`${n === nearest ? "*" : " "} ${n.key.padEnd(28)} :${String(n.line).padEnd(5)} ${text}`);
		}
	}

	const dir = tracesDir(map);
	if (!existsSync(dir)) continue;
	const hits = [];
	for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const trace = JSON.parse(readFileSync(join(dir, name), "utf8"));
		for (const hop of trace.hops) {
			if (hop.file === rel && hop.range && start <= hop.range[1] && end >= hop.range[0]) {
				hits.push(`  ${name}  step ${hop.step}/${trace.hops.length}  ${trace.query.from} -> ${trace.query.to}  (${trace.query.intent})`);
			}
		}
	}
	console.log(hits.length ? `saved traces through this location:\n${hits.join("\n")}` : "saved traces through this location: none");
}
