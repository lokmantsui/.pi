#!/usr/bin/env node
// Verify vscode://file/<path>:<line> links in a rendered d2 SVG.
// Usage: node check-links.mjs diagram.svg
import { existsSync, readFileSync } from "node:fs";

const svgPath = process.argv[2];
if (!svgPath) {
	console.error("usage: check-links.mjs <diagram.svg>");
	process.exit(2);
}

const svg = readFileSync(svgPath, "utf8");
const links = [...new Set([...svg.matchAll(/href="(vscode:\/\/file[^"]+)"/g)].map((m) => m[1]))];
let bad = 0;

for (const link of links) {
	const match = /^vscode:\/\/file(\/.+?)(?::(\d+))?(?::\d+)?$/.exec(decodeURIComponent(link));
	if (!match) {
		console.log(`BAD   ${link} (unparseable)`);
		bad++;
		continue;
	}
	const [, file, lineStr] = match;
	if (!existsSync(file)) {
		console.log(`BAD   ${link} (file not found)`);
		bad++;
		continue;
	}
	const lineCount = readFileSync(file, "utf8").split("\n").length;
	const line = lineStr ? Number(lineStr) : 1;
	if (line < 1 || line > lineCount) {
		console.log(`BAD   ${link} (line ${line} > ${lineCount})`);
		bad++;
		continue;
	}
	const text = readFileSync(file, "utf8").split("\n")[line - 1].trim();
	console.log(`ok    ${file.split("/").slice(-3).join("/")}:${line}  ${text.slice(0, 80)}`);
}

console.log(`\n${links.length} links, ${bad} bad`);
process.exit(bad > 0 ? 1 : 0);
