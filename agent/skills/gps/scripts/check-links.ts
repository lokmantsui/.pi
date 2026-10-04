#!/usr/bin/env node
// Verify vscode://file/<path>:<line> links in a rendered d2 SVG.
// Usage: node check-links.ts diagram.svg
import { existsSync, readFileSync } from "node:fs";
import { parseVscodeLink, readLines } from "./lib.ts";

const svgPath = process.argv[2];
if (!svgPath) {
	console.error("usage: check-links.ts <diagram.svg>");
	process.exit(2);
}

const svg = readFileSync(svgPath, "utf8");
const links = [...new Set([...svg.matchAll(/href="(vscode:\/\/file[^"]+)"/g)].map((m) => m[1]))];
let bad = 0;

for (const link of links) {
	const parsed = parseVscodeLink(link);
	if (!parsed) {
		console.log(`BAD   ${link} (unparseable)`);
		bad++;
		continue;
	}
	const { file, line } = parsed;
	if (!existsSync(file)) {
		console.log(`BAD   ${link} (file not found)`);
		bad++;
		continue;
	}
	const lines = readLines(file);
	if (line < 1 || line > lines.length) {
		console.log(`BAD   ${link} (line ${line} > ${lines.length})`);
		bad++;
		continue;
	}
	const text = lines[line - 1].trim();
	console.log(`ok    ${file.split("/").slice(-3).join("/")}:${line}  ${text.slice(0, 80)}`);
}

console.log(`\n${links.length} links, ${bad} bad`);
process.exit(bad > 0 ? 1 : 0);
