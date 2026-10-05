/**
 * Message board for pi subagents and their host (see the spawn skill).
 *
 * Identity: $SUBAGENT_NAME (set by spawn.sh), else "host".
 *   - Receive: polls $SUBAGENT_BOARD/board.jsonl and pushes messages addressed to me (subagents: also "all")
 *     into my conversation. Idle -> starts a turn. Busy -> queued until the current run ends.
 *   - Send: subagents use the `board_post` tool; the host uses `board.py post <to> "..."`.
 *     All writes go through board.py (it owns locking and ids).
 *
 * The host side stays off until the session runs spawn.sh / board.py, so ordinary pi sessions don't
 * consume board messages.
 */
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BOARD_DIR = (process.env.SUBAGENT_BOARD || join(homedir(), ".pi", "agent", "subagents")).replace(/^~/, homedir());
const BOARD = join(BOARD_DIR, "board.jsonl");
const ME = process.env.SUBAGENT_NAME || "host";
const IS_HOST = ME === "host";
const HINT = "Never wait or poll for replies: end your turn when there's nothing to do; new messages will wake you.";

type Msg = { id: number; from: string; to: string; text: string };

const loadBoard = (): Msg[] => {
	let raw = "";
	try {
		raw = fs.readFileSync(BOARD, "utf8");
	} catch {}
	return raw.split("\n").flatMap((l) => {
		try {
			return l.trim() ? [JSON.parse(l)] : [];
		} catch {
			return []; // partial last line; picked up on the next poll
		}
	});
};

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let cursor = 0;

	function poll() {
		const fresh = loadBoard().filter((m) => m.id > cursor);
		if (!fresh.length) return;
		cursor = fresh[fresh.length - 1].id;
		const mine = fresh.filter((m) => m.from !== ME && (m.to === ME || (!IS_HOST && m.to === "all")));
		if (!mine.length) return;
		const body = mine.map((m) => `[#${m.id} from ${m.from}${m.to === "all" ? " to all" : ""}]\n${m.text}`).join("\n\n");
		pi.sendMessage(
			{ customType: "board", content: `📨 ${mine.length} board message(s):\n\n${body}\n\n(${HINT})`, display: true },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	function start(from: number) {
		if (timer) return;
		cursor = from;
		timer = setInterval(poll, 500);
	}

	pi.on("session_shutdown", async () => clearInterval(timer));

	if (IS_HOST) {
		// start listening once this session works with subagents; skip messages already on the board
		pi.on("tool_call", async (e) => {
			if (!timer && e.toolName === "bash" && /\b(spawn\.sh|board\.py)\b/.test(String((e.input as any)?.command ?? "")))
				start(Math.max(0, ...loadBoard().map((m) => m.id)));
		});
		return;
	}

	pi.on("session_start", async () => start(Number(process.env.SUBAGENT_BOARD_FROM) || 0)); // board position at spawn time

	pi.registerTool({
		name: "board_post",
		label: "Board post",
		description:
			`Send a message on the subagent message board (you are "${ME}"). to: an agent name, "all", or "host" (the orchestrator). ` +
			"Use it to ask someone something, and to reply to whoever asked you once you have the answer (the conclusion only, once). " +
			"Replies are pushed into your conversation: never wait, sleep or poll after posting; end your turn instead. No acknowledgements or thanks.",
		parameters: Type.Object({
			to: Type.String({ description: 'Recipient: agent name, "all", or "host"' }),
			text: Type.String({ description: "Self-contained message" }),
		}),
		async execute(_id, p) {
			const r = await pi.exec("python3", [join(BOARD_DIR, "board.py"), "--as", ME, "post", p.to, p.text]);
			if (r.code !== 0) throw new Error(`board.py post failed: ${r.stderr || r.stdout}`);
			return { content: [{ type: "text", text: r.stdout.trim() }], details: undefined };
		},
	});
}
