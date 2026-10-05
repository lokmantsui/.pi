#!/usr/bin/env python3
"""Pretty-print a pi RPC/JSON event stream (stdin) as a readable transcript."""
import json, sys

C = {"dim": "\033[2m", "b": "\033[1m", "cyan": "\033[36m", "green": "\033[32m",
     "yellow": "\033[33m", "red": "\033[31m", "mag": "\033[35m", "r": "\033[0m"}
def c(k, s): return f"{C[k]}{s}{C['r']}"
def out(s="", end="\n"): sys.stdout.write(s + end); sys.stdout.flush()

def text_of(content):
    if isinstance(content, str): return content
    return "".join(p.get("text", "") for p in content or [] if p.get("type") == "text")

def short(s, n=400):
    s = s.rstrip()
    return s if len(s) <= n else s[:n] + c("dim", f" … (+{len(s)-n} chars)")

midline = False  # are we in the middle of streamed text?
def nl():
    global midline
    if midline: out(); midline = False

for raw in sys.stdin.buffer:
    try: ev = json.loads(raw.decode("utf-8").rstrip("\r\n"))
    except Exception: continue
    t = ev.get("type")

    if t == "response":
        if not ev.get("success"):
            nl(); out(c("red", f"✗ {ev.get('command')}: {ev.get('error')}"))
    elif t == "message_start":
        m = ev.get("message", {})
        if m.get("role") == "user":
            nl(); out(); out(c("cyan", c("b", "▶ user: ")) + c("cyan", text_of(m.get("content"))))
    elif t == "message_update":
        a = ev.get("assistantMessageEvent", {}); at = a.get("type")
        if at == "text_start":
            nl(); out(c("green", c("b", "◀ assistant: ")), end=""); midline = True
        elif at == "text_delta":
            out(a.get("delta", ""), end=""); midline = True
        elif at == "thinking_start":
            nl(); out(c("dim", "💭 "), end=""); midline = True
        elif at == "thinking_delta":
            out(c("dim", a.get("delta", "")), end=""); midline = True
        elif at == "toolcall_end":
            tc = a.get("toolCall", {})
            nl(); out(c("yellow", f"🔧 {tc.get('name')} ") + c("dim", short(json.dumps(tc.get("arguments", {})), 300)))
        elif at in ("text_end", "thinking_end"):
            nl()
    elif t == "tool_execution_end":
        nl()
        res = text_of((ev.get("result") or {}).get("content"))
        col = "red" if ev.get("isError") else "dim"
        out(c(col, "   ↳ " + short(res).replace("\n", "\n     ")))
    elif t == "message_end":
        m = ev.get("message", {})
        if m.get("role") == "assistant" and m.get("stopReason") in ("error", "aborted"):
            nl(); out(c("red", f"✗ {m.get('stopReason')}: {m.get('errorMessage', '')}"))
    elif t == "auto_retry_start" or t == "compaction_start":
        nl(); out(c("mag", f"… {t}"))
    elif t == "extension_ui_request" and str(ev.get("title", "")).startswith("🔐"):
        nl(); out(c("yellow", c("b", "⏸ " + ev["title"])) + c("dim", f"  [id {ev['id']}] waiting for the user…"))
    elif t == "agent_settled":
        nl(); out(c("mag", "── idle ──"))
