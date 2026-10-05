/**
 * Message board for pi subagents and their host: the one communication channel for everyone.
 *
 * Every pi process loads this. Identity: $SUBAGENT_NAME (set by the spawn skill), else "host".
 *   - Receive: watches $SUBAGENT_BOARD/board.jsonl and pushes messages addressed to me (subagents: also
 *     "all") into my conversation. Idle -> starts a turn. Busy -> follow-up (steer if urgent).
 *   - Send: every message is explicit and addressed: subagents use the `board_post` tool, the host uses
 *     `board.py post <to> "..."`. All writes go through board.py (it owns locking and ids).
 *   - Requests and replies (subagents), same rule for everyone:
 *       a message from someone I'm waiting on is their reply; any other direct message (or anything from
 *       host) is a request, and I owe the sender a reply. My post to someone I owe is my reply; my post to
 *       anyone else is a request, and I'm waiting on them.
 *   - Safety net: if I settle owing replies and I'm not waiting on anyone (except those who wait on me),
 *     I get one reminder per request. Nobody else is bothered.
 *   - Loop guard: each message carries a hop count (1 + the highest hop count I received since the last
 *     host message). Subagents drop messages over $BOARD_MAX_HOPS (default 30) and tell host.
 *
 * The host side is off until the session runs spawn.sh / board.py (or /board on), so ordinary pi sessions
 * don't consume board messages. Only one host session listens: $SUBAGENT_BOARD/host.owner holds its pid,
 * and the latest one to activate wins.
 */
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BOARD_DIR = (process.env.SUBAGENT_BOARD || join(homedir(), ".pi", "agent", "subagents")).replace(/^~/, homedir());
const BOARD = join(BOARD_DIR, "board.jsonl");
const BOARD_PY = join(BOARD_DIR, "board.py");
const OWNER = join(BOARD_DIR, "host.owner");
const MAX_HOPS = Number(process.env.BOARD_MAX_HOPS || 30);
const POLL_MS = 500;
const ME = process.env.SUBAGENT_NAME || "host";
const IS_HOST = ME === "host";

type Msg = { id: number; ts: string; from: string; to: string; text: string; urgent?: boolean; hops?: number };

const readText = (p: string) => {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
};
const loadBoard = (): Msg[] =>
	(readText(BOARD) ?? "").split("\n").flatMap((l) => {
		try {
			return l.trim() ? [JSON.parse(l)] : [];
		} catch {
			return []; // partial last line; picked up on the next poll
		}
	});

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let cursor = 0;
	let hops = 0; // highest hop count received since the last host message
	const owed = new Map<string, number>(); // sender -> id of their request I haven't replied to
	const waiting = new Set<string>(); // agents I asked something and haven't heard back from
	const reminded = new Set<number>(); // request ids I was already reminded about
	let aborted = false; // the last run was aborted (abort.sh): don't restart it with a reminder

	async function post(to: string, text: string, urgent?: boolean) {
		const args = [BOARD_PY, "--as", ME, "post", "--hops", String(hops + 1)];
		if (urgent) args.push("--urgent");
		const r = await pi.exec("python3", [...args, to, text]);
		if (r.code !== 0) throw new Error(`board.py post failed: ${r.stderr || r.stdout}`);
		return r.stdout.trim();
	}

	const owns = () => readText(OWNER)?.trim() === String(process.pid);

	function start(from: number) {
		if (timer) return false;
		cursor = from;
		if (IS_HOST) fs.writeFileSync(OWNER, String(process.pid));
		timer = setInterval(poll, POLL_MS);
		return true;
	}
	function stop() {
		if (timer) clearInterval(timer);
		timer = undefined;
		if (IS_HOST && owns()) fs.rmSync(OWNER, { force: true });
	}

	/** Subagent bookkeeping for one board message (mine or addressed to me). */
	function track(m: Msg) {
		if (m.from === ME) {
			// my post: a reply to someone I owe, otherwise a request to them
			if (m.to === "all") return;
			if (owed.has(m.to)) owed.delete(m.to);
			else if (m.to !== "host") waiting.add(m.to);
			return;
		}
		hops = m.from === "host" ? 0 : Math.max(hops, m.hops ?? 0);
		if (waiting.has(m.from)) waiting.delete(m.from); // their reply
		else if (m.from === "host" || m.to === ME) owed.set(m.from, m.id); // a request
	}

	function poll() {
		if (IS_HOST && !owns()) return stop(); // another host session took over
		const fresh = loadBoard().filter((m) => m.id > cursor);
		if (!fresh.length) return;
		cursor = fresh[fresh.length - 1].id;
		const deliver: Msg[] = [];
		for (const m of fresh) {
			if (!IS_HOST && m.from === ME) {
				track(m);
				continue;
			}
			if (m.from === ME || !(m.to === ME || (!IS_HOST && m.to === "all"))) continue;
			if (!IS_HOST && m.from !== "host" && (m.hops ?? 0) > MAX_HOPS) {
				post("host", `Hop limit ${MAX_HOPS}: dropped #${m.id} from ${m.from} to ${ME}. Agents may be in a reply loop.`).catch(() => {});
				continue;
			}
			if (!IS_HOST) track(m);
			deliver.push(m);
		}
		if (!IS_HOST)
			try {
				fs.mkdirSync(join(BOARD_DIR, "hops"), { recursive: true });
				fs.writeFileSync(join(BOARD_DIR, "hops", ME), String(hops)); // for posts made with board.py by hand
			} catch {}
		if (!deliver.length) return;

		const body = deliver
			.map((m) => `[#${m.id} from ${m.from}${m.to === "all" ? " to all" : ""}${m.urgent ? ", urgent" : ""}]\n${m.text}`)
			.join("\n\n");
		const askers = [...new Set(deliver.filter((m) => owed.get(m.from) === m.id).map((m) => m.from))];
		const hint = IS_HOST
			? "Don't wait or poll; end your turn when there's nothing to do. New messages will wake you."
			: (askers.length ? `When you have the answer, reply with board_post to ${askers.join(", ")} (once, the conclusion only). ` : "") +
				"Never wait or poll for replies: end your turn, and replies will wake you.";
		pi.sendMessage(
			{ customType: "board", content: `📨 ${deliver.length} board message(s):\n\n${body}\n\n(${hint})`, display: true },
			{ triggerTurn: true, deliverAs: deliver.some((m) => m.urgent) ? "steer" : "followUp" },
		);
	}

	pi.on("session_shutdown", async () => stop());

	if (!IS_HOST) {
		// ---------------- subagent ----------------
		pi.on("session_start", async () => {
			start(Number(process.env.SUBAGENT_BOARD_FROM) || 0); // spawn.sh: board position at spawn time
		});
		pi.on("agent_start", async () => {
			aborted = false;
		});
		pi.on("message_end", async (e) => {
			const m: any = e.message;
			if (m.role === "assistant" && (m.stopReason === "aborted" || (m.stopReason === "error" && /\babort/i.test(m.errorMessage ?? ""))))
				aborted = true;
		});
		pi.on("agent_settled", async () => {
			poll(); // catch up on my own posts from this run
			if (aborted) {
				for (const id of owed.values()) reminded.add(id); // stopped on purpose: stay stopped
				return;
			}
			// still waiting on others (ignoring agents that are waiting on me)? the work isn't finished yet
			if ([...waiting].some((a) => !owed.has(a))) return;
			const due = [...owed].filter(([, id]) => !reminded.has(id));
			if (!due.length) return;
			for (const [, id] of due) reminded.add(id);
			pi.sendMessage(
				{
					customType: "board",
					display: true,
					content:
						`⏰ You haven't replied to: ${due.map(([who, id]) => `${who} (#${id})`).join(", ")}. ` +
						"If you have the answer, send it now with board_post. If you can't finish, tell them what's blocking you. Then end your turn.",
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		});
		// agents may still try to poll by hand; tell them it's pointless
		pi.on("tool_call", async (e) => {
			const cmd = e.toolName === "bash" ? String((e.input as any)?.command ?? "") : "";
			if (/board\.(py|jsonl)/.test(cmd) && /\b(while|until|sleep|watch|tail -f)\b/.test(cmd))
				return { block: true, reason: "Don't poll the board: messages are pushed into your conversation. End your turn to wait." };
		});

		pi.registerTool({
			name: "board_post",
			label: "Board post",
			description:
				`Send a message on the subagent message board (you are "${ME}"). to: an agent name, "all", or "host" (the orchestrator). ` +
				"Use it to ask someone something, and to reply to whoever asked you (host or agent) once you have the answer: " +
				"only the conclusion, once. Replies are pushed into your conversation automatically: never wait, sleep or poll after " +
				"posting; end your turn instead. No acknowledgements or thanks.",
			parameters: Type.Object({
				to: Type.String({ description: 'Recipient: agent name, "all", or "host"' }),
				text: Type.String({ description: "Self-contained message" }),
				urgent: Type.Optional(Type.Boolean({ description: "Interrupt the recipient's current work (rarely needed)" })),
			}),
			async execute(_id, p) {
				const isReply = owed.has(p.to); // before posting: poll() updates owed once it sees the post
				const out = await post(p.to, p.text, p.urgent);
				return {
					content: [{ type: "text", text: isReply || p.to === "host" || p.to === "all" ? out : `${out}. Their reply will be pushed to you; don't wait for it.` }],
					details: undefined,
				};
			},
		});
	} else {
		// ---------------- host: listens once this session works with subagents ----------------
		const activate = () => start(Math.max(0, ...loadBoard().map((m) => m.id))); // skip stale messages
		pi.on("tool_call", async (e, ctx) => {
			if (timer && owns()) return;
			const cmd = e.toolName === "bash" ? String((e.input as any)?.command ?? "") : "";
			if (!/\b(spawn\.sh|board\.py)\b/.test(cmd)) return;
			stop();
			if (activate() && ctx.hasUI) ctx.ui.notify("Board: listening as host", "info");
		});
		pi.registerCommand("board", {
			description: "Host board listener: on | off | status",
			handler: async (args, ctx) => {
				const a = args.trim() || "status";
				if (a === "on") {
					stop();
					activate();
				} else if (a === "off") stop();
				ctx.ui.notify(`Board (${BOARD}): ${timer && owns() ? "listening as host" : "off"}`, "info");
			},
		});
	}
}
