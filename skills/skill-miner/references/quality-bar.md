# Quality bar for generating / modifying a skill

Most conversation groups should NOT become skills — a wrong or vague skill is worse
than none, because it pollutes the skill list and misfires. A candidate is worth a
skill only when it clears this gate:

> **Dimension 1 AND (Dimension 2 OR Dimension 3).**

The three dimensions are **equally important** — none outranks the others.

## The three dimensions

1. **Repeatable** — the task or knowledge repeats, is repeatable, or has a high
   chance of recurring. Past recurrence is the strongest evidence, but a task that
   plausibly recurs counts too; a genuine one-off never does. *(Required.)*

2. **Room to do it better** — there is meaningful **environment feedback** or
   **user feedback**, so next time the task can be done better or faster than the
   first:
   - **Environment feedback** — what running the request revealed: what failed, a
     recurring quirk of this environment, a roundabout path and its shortcut, a
     heuristic earned by doing the task. **These are literally skills.** (A one-time
     setup step is a one-line gotcha at most, never its own skill.)
   - **User feedback** — the user is the expert and their feedback is rare; mine it
     to pick their brain. A correction, a better approach they knew and we didn't,
     the right way here, a domain fact we got wrong.

3. **Saves the user repeating themselves** — the user keeps **requesting** the same
   thing across sessions. Extract it once (a default, a rule, a step) so they don't
   have to ask again.

(Environment feedback is listed first deliberately — it edges out user feedback in
value. But all three dimensions carry equal weight in the gate.)

## Also required

- **Concrete** — a clear trigger ("use when…") and concrete steps, commands, the
  specific rule, or the quirk + workaround. Reject "an assistant for X" / "help with
  Y".
- **Non-overlapping** — doesn't duplicate a skill already in context; if it partially
  overlaps, **extend** that skill in place. Lacking the path, run
  `scripts/skills_inventory.py` once to find the file to edit.

## Reject if any of these (kill switches)

- Fails the gate — a one-off with no repeat potential, or a repeatable task with
  nothing to improve and no repeated ask.
- Vague, broad, or aspirational ("improve debugging", "frontend helper").
- A one-time setup step or a now-finished migration/feature.
- Substantially overlaps an existing skill without a concrete extension.
- General engineering advice the model already knows. Skills encode the *specific* —
  about THIS user / THIS environment. If it could be in an LLM's pretraining data,
  leave it out.

## Output discipline

- **Cap: 5 skills** per run. If more than 5 pass, keep the 5 highest-impact and list
  the rest as "deferred".
- **Prefer extending** an existing skill over creating a near-duplicate.
- Rank the chosen skills; for each notable rejected candidate, say in one line which
  dimension it missed.
