// Shared helpers and types for the gps skill scripts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** One step of a traced A -> B path (see SKILL.md "Trace JSON"). */
export interface Hop {
	step: number;
	/** Repo-relative path. */
	file: string;
	line: number;
	/** Enclosing function [start, end], 1-based inclusive. */
	range?: [number, number];
	symbol?: string;
	/** Verbatim source text expected on `line`. */
	via?: string;
	carries?: string;
	/** Existing map node key. */
	node?: string;
	/** Map container for a new node (when `node` is absent). */
	container?: string;
	/** Label for a new node (when `node` is absent). */
	label?: string;
	edge?: string;
	sha?: string;
}

export interface Trace {
	/** Map path relative to the trace JSON. */
	map: string;
	/** Absolute repo root that hop files are relative to. */
	root: string;
	commit?: string;
	traced_at?: string;
	verified_at?: string;
	query: { from: string; to: string; intent: string };
	summary?: string;
	hops: Hop[];
	gaps?: string[];
}

export interface MapNode {
	key: string;
	file?: string;
	line?: number;
}

export interface Loc {
	file: string;
	start: number;
	end: number;
	repo?: string;
}

export function readTrace(path: string): Trace {
	return JSON.parse(readFileSync(path, "utf8")) as Trace;
}

export function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function d2Bin(): string {
	return execFileSync(join(here, "ensure-d2.sh"), { encoding: "utf8" }).trim();
}

export function compile(input: string, output: string): void {
	try {
		execFileSync(d2Bin(), ["--layout", "elk", input, output], { stdio: "pipe" });
	} catch (e) {
		const err = e as { stderr?: Buffer; message: string };
		throw new Error(`d2 failed on ${input}:\n${err.stderr?.toString() ?? err.message}`);
	}
}

function dirOf(path: string): string {
	return existsSync(path) && statSync(path).isFile() ? dirname(path) : path;
}

export function gitRoot(path: string): string | undefined {
	try {
		return execFileSync("git", ["-C", dirOf(path), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

export function gitCommit(path: string): string | undefined {
	try {
		return execFileSync("git", ["-C", dirOf(path), "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

export function readLines(file: string): string[] {
	return readFileSync(file, "utf8").split("\n");
}

/** Parse "vscode://file/abs/path:12" into { file, line }. */
export function parseVscodeLink(link: string): { file: string; line: number } | undefined {
	const m = /^vscode:\/\/file(\/.+?)(?::(\d+))?(?::\d+)?$/.exec(decodeURIComponent(link));
	return m ? { file: m[1], line: m[2] ? Number(m[2]) : 1 } : undefined;
}

/**
 * Resolve a location string to { file (absolute), start, end }.
 * Accepts:
 *   https://vscode.dev/github/<org>/<repo>/blob/<ref>/<path>#L508-L510
 *   https://github.com/<org>/<repo>/blob/<ref>/<path>#L508-L510
 *   vscode://file/<abs>:<line>
 *   <path>:<line>[-<end>]   <path>#L<line>[-L<end>]   (relative to cwd or git root)
 */
export function parseLoc(loc: string, cwd: string = process.cwd()): Loc {
	const range = (a: string | number, b?: string | number) => ({ start: Number(a), end: Number(b ?? a) });
	const web = /^https:\/\/(?:vscode\.dev\/github|github\.com)\/([^/]+)\/([^/]+)\/blob\/[^/]+\/([^#]+)(?:#L(\d+)(?:-L?(\d+))?)?$/.exec(loc);
	if (web) {
		const root = gitRoot(cwd);
		if (!root) throw new Error(`not in a git repo, cannot map ${loc} to a local file`);
		return { file: join(root, decodeURIComponent(web[3])), ...range(web[4] ?? 1, web[5]), repo: `${web[1]}/${web[2]}` };
	}
	if (loc.startsWith("vscode://")) {
		const v = parseVscodeLink(loc);
		if (!v) throw new Error(`unparseable vscode link: ${loc}`);
		return { file: v.file, ...range(v.line) };
	}
	const local = /^(.+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/.exec(loc);
	if (!local) throw new Error(`unparseable location: ${loc}`);
	const [, path, a, b, c, d] = local;
	let file = isAbsolute(path) ? path : resolve(cwd, path);
	if (!existsSync(file)) {
		const root = gitRoot(cwd);
		if (root && existsSync(join(root, path))) file = join(root, path);
	}
	return { file, ...range(a ?? c ?? 1, b ?? d) };
}

/**
 * Compile a map and return its nodes: [{ key, file, line }] (file/line undefined when unlinked).
 * Keys come from d2's SVG output, where every shape group has class=base64(key).
 */
export function mapNodes(mapPath: string): MapNode[] {
	const svg = `/tmp/gps-map-${sha(readFileSync(mapPath, "utf8") + mapPath)}.svg`;
	if (!existsSync(svg)) compile(mapPath, svg);
	const text = readFileSync(svg, "utf8");
	const nodes = new Map<string, MapNode>();
	for (const m of text.matchAll(/(?:<a href="([^"]+)"[^>]*>)?<g class="([A-Za-z0-9+/=]+)">/g)) {
		const key = Buffer.from(m[2], "base64").toString("utf8");
		if (Buffer.from(key, "utf8").toString("base64") !== m[2] || !/^[\x20-\x7e]+$/.test(key)) continue;
		if (key.includes("->") || key.includes("<-") || key.includes("--")) continue;
		const link = m[1] ? parseVscodeLink(m[1]) : undefined;
		if (!nodes.has(key) || link) nodes.set(key, { key, file: link?.file, line: link?.line });
	}
	return [...nodes.values()];
}

/** Fixed map file name inside a gps dir: pkg/architecture.gps/map.d2 (+ map.svg). Reserved: no trace may use slug "map". */
export const MAP_NAME = "map";

/** Directory holding a map and its traces: pkg/architecture.gps/map.d2 -> pkg/architecture.gps/ */
export function tracesDir(mapPath: string): string {
	return dirname(mapPath);
}

/** All gps maps (*.gps/map.d2 outside node_modules) in the repo containing dir. */
export function listMaps(dir: string): string[] {
	const root = gitRoot(dir);
	if (!root) return [];
	const out = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "*.d2"], {
		encoding: "utf8",
	});
	return out
		.split("\n")
		.filter((p) => p && p.endsWith(`.gps/${MAP_NAME}.d2`) && !p.includes("node_modules/"))
		.map((p) => join(root, p));
}
