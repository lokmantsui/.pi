/**
 * Save the most recent prompt to disk for inspection (overwritten each time).
 *
 *   ~/.pi/agent/last-prompt/system.txt     – the system prompt used for that run
 *   ~/.pi/agent/last-prompt/payload.json   – the exact request body of the latest model call
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUT_DIR = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "last-prompt");

function save(name: string, content: string): void {
	try {
		mkdirSync(OUT_DIR, { recursive: true });
		writeFileSync(join(OUT_DIR, name), content, "utf8");
	} catch {
		// Never let logging break a run.
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		save("system.txt", event.systemPrompt + "\n");
	});

	pi.on("before_provider_request", (event) => {
		save("payload.json", JSON.stringify(event.payload, null, 2) + "\n");
	});
}
