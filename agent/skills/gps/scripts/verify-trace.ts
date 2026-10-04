#!/usr/bin/env node
// Mechanically verify a gps trace (an LLM-produced A -> B path). The LLM cannot be trusted to check itself:
//   via   - each hop claims verbatim source text `via` on `line`. Confirms the hop is not fabricated.
//   sha   - each hop stores a hash of its `range` (enclosing function). A mismatch means the code changed
//           since the trace was recorded, so that hop must be re-traced.
//   moved - if `via` is no longer on `line` but occurs elsewhere (nearest match wins) and the hash matches
//           at the shifted range, the code only shifted. --fix rewrites line/range (no LLM needed) and then checks the hash at the new range.
// Usage: node verify-trace.ts <trace.json> [--stamp] [--fix]
//   --stamp  (re)compute every hop's sha; use right after writing a new trace
// Exit 0 = VERIFIED, 1 = DRIFTED (run --fix), 2 = STALE or BAD (re-trace listed hops).
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLines, readTrace, sha } from "./lib.ts";

const args = process.argv.slice(2);
const tracePath = args.find((a) => !a.startsWith("--"));
const doStamp = args.includes("--stamp");
const doFix = args.includes("--fix");
if (!tracePath) {
	console.error("usage: verify-trace.ts <trace.json> [--stamp] [--fix]");
	process.exit(2);
}

type Status = "ok" | "moved" | "stale" | "bad";

const trace = readTrace(tracePath);
const rangeText = (lines: string[], [a, b]: [number, number]): string => lines.slice(a - 1, b).join("\n");
const counts: Record<Status, number> = { ok: 0, moved: 0, stale: 0, bad: 0 };
let changed = false;

for (const hop of trace.hops) {
	const label = `step ${hop.step} ${hop.file}:${hop.line}`;
	const abs = join(trace.root, hop.file);
	const report = (status: Status, msg: string): void => {
		counts[status]++;
		console.log(`${status.toUpperCase().padEnd(6)} ${label}  ${msg}`);
	};
	if (!existsSync(abs)) {
		report("bad", "file not found");
		continue;
	}
	const lines = readLines(abs);
	if (!hop.via || !hop.range || hop.range[0] > hop.line || hop.range[1] < hop.line) {
		report("bad", "missing via, or range does not contain line");
		continue;
	}

	let delta = 0;
	if (!(lines[hop.line - 1] ?? "").includes(hop.via)) {
		// Nearest occurrence wins; a wrong pick still fails the sha check below, so this cannot fake a pass.
		const via = hop.via;
		const hits = lines.flatMap((l, i) => (l.includes(via) ? [i + 1] : []));
		const dist = (n: number): number => Math.abs(n - hop.line);
		hits.sort((a, b) => dist(a) - dist(b));
		if (hits.length === 0 || (hits.length > 1 && dist(hits[0]) === dist(hits[1]))) {
			report("bad", `via not found unambiguously (${hits.length} matches): ${JSON.stringify(hop.via)}`);
			continue;
		}
		delta = hits[0] - hop.line;
	}
	const range: [number, number] = [hop.range[0] + delta, hop.range[1] + delta];
	const current = sha(rangeText(lines, range));

	if (doStamp) {
		hop.sha = current;
		changed = true;
	}
	if (hop.sha !== current) {
		report("stale", `body changed since trace (sha ${hop.sha} -> ${current}); re-trace this hop`);
		continue;
	}
	if (delta === 0) {
		report("ok", `${hop.via}`);
		continue;
	}
	if (doFix) {
		hop.line += delta;
		hop.range = range;
		changed = true;
		report("ok", `fixed: moved ${delta > 0 ? "+" : ""}${delta} lines`);
	} else {
		report("moved", `code shifted ${delta > 0 ? "+" : ""}${delta} lines, body unchanged; run --fix`);
	}
}

if (changed) {
	trace.verified_at = new Date().toISOString();
	writeFileSync(tracePath, `${JSON.stringify(trace, null, "\t")}\n`);
}

const status = counts.bad || counts.stale ? "STALE" : counts.moved ? "DRIFTED" : "VERIFIED";
console.log(`\n${status}: ${counts.ok} ok, ${counts.moved} moved, ${counts.stale} stale, ${counts.bad} bad`);
process.exit(status === "VERIFIED" ? 0 : status === "DRIFTED" ? 1 : 2);
