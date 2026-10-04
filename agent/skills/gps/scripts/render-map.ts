#!/usr/bin/env node
// Render a gps map in one step: compiles map.d2 -> map.svg (clickable),
// and verifies every vscode:// link.
// Usage: node render-map.ts pkg/architecture.gps/map.d2
// Exit 0 = ok, 1 = bad links, 2 = usage / d2 error.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "./lib.ts";

const arg = process.argv[2];
const mapPath = resolve(arg ?? "");
if (!arg || !existsSync(mapPath) || !mapPath.endsWith(".d2")) {
	console.error("usage: render-map.ts pkg/architecture.gps/map.d2");
	process.exit(2);
}

const svgPath = mapPath.replace(/\.d2$/, ".svg");
try {
	compile(mapPath, svgPath);
} catch (e) {
	console.error((e as Error).message);
	process.exit(2);
}
console.log(`wrote ${relative(process.cwd(), svgPath)}`);

const checkLinks = join(dirname(fileURLToPath(import.meta.url)), "check-links.ts");
try {
	console.log(execFileSync(process.execPath, [checkLinks, svgPath], { encoding: "utf8" }).trim());
} catch (e) {
	console.log((e as { stdout?: string }).stdout?.trim());
	process.exit(1);
}
