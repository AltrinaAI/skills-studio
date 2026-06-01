---
name: skill-studio
description: Use this skill to load the secrets you manage in Skill Studio (for example OPENAI_API_KEY, GITHUB_TOKEN) into your environment. Run it once at the start of a task whenever another skill or command needs credentials, or reports a missing API key, token, or environment variable.
---

# Skill Studio — activate secrets

Skill Studio keeps your API keys and secrets in one place and renders them to a
single env file. This skill loads them into the environment so the tools you run
can see them.

## Load the secrets

Run this once, through `eval`, pointing at this skill's folder:

```bash
eval "$(bash ./activate.sh --print)"
```

(Use the absolute path to `activate.sh` if your shell isn't already in this
folder.) It exports every managed secret into the **current** shell and, where
possible, wires your shell startup files so shells started later inherit them
too. It prints only the variable **names** it activated — never the values.

## Sandboxed agents (read-only HOME, fresh shell per command)

Some agents (for example Codex) run each command in a **fresh shell** with a
**read-only HOME**, so a separate `activate` step doesn't persist and the
startup files can't be patched. There, source the env file **in the same
command** that needs the secrets — this only *reads* a file, so it works even
when HOME is read-only:

```bash
. "${SKILL_STUDIO_ENV:-$HOME/.config/skill-studio/env}" && your-command
```

If it reports that no secrets are configured, add them in Skill Studio and run
it again.
