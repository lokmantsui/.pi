---
name: commit
description: Git commit the current changes with Pi as the commit author (the user stays committer). Use only when the user explicitly invokes /skill:commit.
disable-model-invocation: true
---

# Commit as Pi

Commit changes with Pi as the **author** while the user's git identity remains the **committer**.

1. Inspect the repo: `git status --short` and `git diff` (plus `git diff --cached` if anything is staged). If there is nothing to commit, say so and stop.
2. Decide what to include:
   - If the user named files or a scope, commit only that.
   - Otherwise commit the changes made in this session. If unrelated or pre-existing changes are present, ask before including them.
   - Never commit secrets, build output, or files that should be ignored (e.g. `node_modules`, logs); mention them instead.
3. Stage with explicit paths (`git add <paths>`), not `git add -A`, unless everything is clearly in scope.
4. Write the message in the repo's existing style (check `git log --oneline -10`): a short imperative subject (≤ 72 chars), then a blank line and a brief body explaining *why* if the change isn't trivial. Use any text the user passed with the command as guidance.
5. Commit with Pi as author, where `<model>` is the part of `$PI_MODEL` after the last `/` (e.g. `anthropic/claude-opus-5.5` → `claude-opus-5.5`):

   ```bash
   git commit --author="Pi (<model>) <pi@localhost>" -m "Subject" -m "Body"
   ```

   Don't change `user.name`/`user.email` or set `GIT_COMMITTER_*`; the user's identity must remain the committer.
6. Show the result with `git log -1 --format='%h %s%n  author:    %an <%ae>%n  committer: %cn <%ce>'`.

Do not push, amend, or rewrite history unless the user asks.
