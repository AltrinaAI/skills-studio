#!/usr/bin/env python3
"""Stage 2 — distill each conversation into a structured row (the JSONL).

For every discovered conversation: parse it (agent-specific adapter) to user
turns + touched paths, infer `main_dir` (deepest folder where most work happened)
and `datetime`/`skills_used` deterministically, then call a CHEAP LLM for
`topics` (scope, usually one — doubles as the headline — for grouping), `tasks`
(what the user asked the agent to do, for spotting repeated asks) and two
feedback arrays — `env_feedback` (what running the work revealed: failures,
recurring quirks, roundabout paths + shortcuts) and `user_feedback` (the user's
reactions/corrections — expert insight). The cheap call sees only user turns, so
`env_feedback` is what the user *said about* what ran, not raw tool output; each
array is `[]` for the typical session. Writes conversations.jsonl.

  python3 extract.py --inventory ./out/inventory.jsonl \
                     --out ./out/conversations.jsonl --workers 12
  python3 extract.py --limit 10        # quick sample while testing
"""
import argparse, json, os, sys
from concurrent.futures import ThreadPoolExecutor
import common, llm

SYS = ("You are a strict JSON labeler. Output ONLY one JSON object: no prose, "
       "no code fences, no echoing of input data.")

PROMPT = """Read ONE coding-agent session — only the USER's messages, in order (`[skill used: X]` marks where the agent ran a skill; the agent's replies and tool output are NOT shown).{skill_note} Name what it was about, then copy out three kinds of signal in the user's own words (never guess). Most arrays are empty for a routine session.

Output ONLY one JSON object with exactly these keys:
- "topics": array of FULL SENTENCES naming the session's GENERAL subject. ALMOST ALWAYS ONE — roll every sub-step, tweak, bug-fix, and related follow-up of the same overall effort into that single topic. Add a second element ONLY when the session covers a genuinely UNRELATED effort (rare); even then give each its own element — never join two subjects with ";" or "and" in one string.
- "tasks": array of SHORT strings — the concrete tasks the user gave the agent, with any constraint they attached up front ("add a dark-mode toggle", "use the existing helper, don't write a new one", "don't touch the tests"). The WHAT the user asked for.
- "env_feedback": array of SHORT strings — what the user said the ENVIRONMENT did when something ran: a failure or surprise ("migration failed with a lock timeout"), a recurring quirk worked around ("must run from repo root or paths break"), a roundabout path and its shortcut ("don't rebuild the image, just restart the worker"). Mark a one-time setup step "(setup)". Use [] when none.
- "user_feedback": array of SHORT strings — the user's REACTION to work already done: a correction ("no, don't hardcode the URL"), a better way they knew and we didn't, a domain fact we got wrong, clear approval or frustration ("third time you've made this mistake"). Use [] when none.

Unsure where it goes? An up-front ask → tasks; a reaction to work done → user_feedback. Empty/trivial session: a single topic "trivial/empty session", [] elsewhere.

USER MESSAGES (in order):
<<<
{body}
>>>"""

SKILL_NOTE = (" What the user says right after a `[skill used: X]` line is often feedback on that"
              " skill — that it did the right or wrong thing, or that its steps failed here.")

def _as_list(v, cap_items=6, cap_len=300):
    """Coerce a small model's value into a clean list of short strings — it may
    hand back a bare string, a dict, or null instead of an array."""
    if v is None: return []
    if isinstance(v, dict): v = list(v.values())
    if isinstance(v, str): v = [v] if v.strip() else []
    if not isinstance(v, (list, tuple)): return []
    return [str(x).strip()[:cap_len] for x in v if str(x).strip()][:cap_items]

def label(condensed):
    has_skills = "[skill used:" in (condensed or "")
    try:
        j = llm.complete_json(SYS, PROMPT.format(
                body=condensed or "(no user messages)",
                skill_note=SKILL_NOTE if has_skills else ""), max_tokens=800)
        tp = j.get("topics")
        if isinstance(tp, str): tp = [tp]
        return {"topics": [str(x).strip()[:400] for x in (tp or []) if str(x).strip()][:5],
                "tasks": _as_list(j.get("tasks")),
                "env_feedback": _as_list(j.get("env_feedback")),
                "user_feedback": _as_list(j.get("user_feedback"))}
    except Exception as e:
        return {"topics": ["<error>"], "tasks": [], "env_feedback": [],
                "user_feedback": [], "error": str(e)[:120]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", default="./out/inventory.jsonl")
    ap.add_argument("--out", default="./out/conversations.jsonl")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit", type=int, default=0, help="cap conversations (testing)")
    args = ap.parse_args()

    try:
        b, m = llm.detect_backend(); print(f"LLM backend: {b}/{m}", file=sys.stderr)
    except RuntimeError as e:
        sys.exit(str(e))

    inv = [json.loads(l) for l in open(args.inventory)]
    if args.limit: inv = inv[-args.limit:]   # newest N (inventory is mtime-sorted)
    print(f"parsing {len(inv)} conversations...", file=sys.stderr)

    records = []
    for row in inv:
        parse = common.ADAPTERS[row["agent"]][1]
        try: rec = parse(row["path"])
        except Exception: rec = None
        if rec: records.append(rec)
    print(f"  {len(records)} have real user content (rest skipped: empty/subagent)", file=sys.stderr)

    project_roots = {r["primary_cwd"] for r in records if r.get("primary_cwd")}
    for r in records:
        r["main_dir"] = common.shorten(common.compute_main_dir(r["weighted_paths"], project_roots, r["primary_cwd"]))

    def work(r):
        r.update(label(r["condensed"]))
        return r
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = []
        for r in ex.map(work, records):
            done += 1
            if done % 10 == 0 or done == len(records):
                print(f"  labeled {done}/{len(records)}", file=sys.stderr)
            results.append(r)

    results.sort(key=lambda r: r.get("first_ts") or "")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    nerr = 0
    with open(args.out, "w") as f:
        for r in results:
            if r["topics"] == ["<error>"]: nerr += 1
            f.write(json.dumps({
                "agent": r["agent"], "session_id": r["session_id"], "path": r["path"],
                "main_dir": r["main_dir"], "datetime": r["first_ts"],
                "n_user_turns": r["n_user_turns"], "topics": r["topics"],
                "tasks": r["tasks"], "skills_used": r["skills_used"],
                "env_feedback": r["env_feedback"], "user_feedback": r["user_feedback"],
            }, ensure_ascii=False) + "\n")
    print(f"wrote {len(results)} rows -> {args.out}  ({nerr} label errors)", file=sys.stderr)

if __name__ == "__main__":
    main()
