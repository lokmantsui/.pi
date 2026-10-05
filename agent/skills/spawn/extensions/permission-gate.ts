/**
 * Subagent permission gate (loaded into every subagent by spawn.sh).
 *
 * Read-only tool calls run freely: read/grep/find/ls, and bash commands where every segment is a
 * known read-only command (plus board.py messaging). Anything else asks for permission through
 * ctx.ui.select(), which in RPC mode becomes an `extension_ui_request` in out.jsonl and blocks until
 * the host sends an `extension_ui_response` (scripts/permit.sh), after asking the human user.
 *
 * Response value: "Allow" runs the call. Anything else blocks it; the value is passed to the model as
 * the reason (e.g. "Deny: write to /tmp instead").
 */

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

// Commands that only read state. Each bash segment must start with one of these.
const SAFE_SEGMENT = [
	/^(cat|head|tail|less|more|grep|egrep|fgrep|rg|fd|ls|eza|tree|pwd|echo|printf|wc|sort|uniq|cut|tr|column|diff|cmp|file|stat|du|df|which|whereis|type|printenv|uname|whoami|id|date|cal|uptime|ps|free|lsof|realpath|readlink|basename|dirname|md5sum|sha\d*sum|jq|bat|nl|true|test|\[)\b/,
	/^find\b(?!.*\s-(exec|execdir|ok|okdir|delete|fprint\S*|fls)\b)/,
	/^sed\s+-n\b(?!.*\bw\b)/,
	/^awk\b(?!.*\bsystem\s*\()(?!.*>)/,
	/^git\s+(status|log|diff|show|blame|grep|rev-parse|ls-files|ls-tree|ls-remote|describe|shortlog|reflog\s+show|cat-file|config\s+--get)\b/,
	/^git\s+(branch|remote|tag|stash\s+list)(\s+(-[avrl]+|--list|--all|--verbose|-v))*\s*$/,
	/^(npm|pnpm|yarn)\s+(ls|list|view|info|why|outdated)\b/,
	/^(node|python3?|pi|go|cargo|rustc|java)\s+(--version|-v|-V)\s*$/,
	/^tmux\s+(ls|list-\w+|capture-pane|display-message|has-session|show-\w+)\b/,
	/^(\S*\/)?(board\.py|\$B|"\$B")\s+(post|log|who|read)\b/, // subagent message board
	/^[A-Za-z_]\w*=[^\s;&|`$]*$/, // plain variable assignment, e.g. B=~/.pi/agent/subagents/board.py
	/^[A-Za-z_]\w*="?\$HOME\/[^\s;&|`]*"?$/,
	/^cd(\s+\S+)?$/,
	/^sleep\s+\d+(\.\d+)?$/,
];

function isReadOnlyBash(command: string): boolean {
	// command substitution / process substitution / heredocs: can't reason about them -> ask
	const noSingle = command.replace(/'[^']*'/g, "''"); // single-quoted text is inert
	if (/`|\$\(|<\(|>\(|<</.test(noSingle)) return false;
	// sed/awk scripts live in quotes and can write files or run commands
	if (/\bawk\b.*(system\s*\(|getline|print[^|;]*>|\|\s*")/s.test(command)) return false;
	if (/\bsed\b.*(\s-i|\s--in-place|\bw\s|\/w\b|\/e\b|\be\s)/s.test(command)) return false;
	const unquoted = noSingle.replace(/"(\\.|[^"\\])*"/g, '""'); // so `;`, `&`, `>` inside quotes don't count
	// harmless redirections
	const cleaned = unquoted.replace(/\s*\d?>&\d/g, "").replace(/\s*(\d|&)?>>?\s*\/dev\/null/g, "");
	if (/>/.test(cleaned)) return false; // any other output redirection writes a file
	const segments = cleaned
		.split(/\|\||&&|;|\||\n|&/)
		.map((s) => s.trim())
		.filter(Boolean);
	return segments.length > 0 && segments.every((s) => SAFE_SEGMENT.some((p) => p.test(s)));
}

function describe(toolName: string, input: any): string {
	if (toolName === "bash") return `bash: ${input?.command}`;
	if (toolName === "write") return `write ${input?.path} (${String(input?.content ?? "").length} chars)`;
	if (toolName === "edit") {
		const edits = input?.edits ?? [];
		return `edit ${input?.path} (${edits.length} replacement${edits.length === 1 ? "" : "s"})`;
	}
	const s = JSON.stringify(input ?? {});
	return `${toolName} ${s.length > 600 ? s.slice(0, 600) + "…" : s}`;
}

export default function (pi: any) {
	const name = process.env.SUBAGENT_NAME ?? "subagent";

	pi.on("tool_call", async (event: any, ctx: any) => {
		if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;
		if (event.toolName === "bash" && isReadOnlyBash(String(event.input?.command ?? ""))) return undefined;

		if (!ctx.hasUI) return { block: true, reason: "Needs permission, but no UI is available to ask for it." };

		const answer: string | undefined = await ctx.ui.select(
			`🔐 Permission request from ${name}: ${describe(event.toolName, event.input)}`,
			["Allow", "Deny"],
		);
		if (answer === "Allow") return undefined;
		const reason =
			!answer || answer === "Deny"
				? "The user denied permission for this action."
				: `The user denied permission for this action: ${answer.replace(/^Deny:?\s*/i, "")}`;
		return { block: true, reason: `${reason} Don't retry it as-is; adjust your approach or ask the host.` };
	});
}
