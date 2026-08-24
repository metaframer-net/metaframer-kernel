# Rules

This file is a short, pointer-based index. It does not restate policy content that already lives
in a canonical source elsewhere in this repository or in the global managed directives.

- Managed Claude invocation routing, the full-QA budget (exactly two runs per change package),
  worker-admission and Kernel-authorship rules: the machine owner's global managed directives
  (outside this repository, highest precedence).
- Ultra-fast v1 pilot guardrails (bounded package shape, JIT Pane, dynamic concurrency, pilot
  checkpoint, event-driven GC-02): `planning/ultra-fast-v1-policy.json`, projected in
  `.claude/skills/ultra-fast-development/SKILL.md`.
- Pane panel lifecycle/cleanup: the global Pane-garbage-collector lifecycle directive and the
  `pane-garbage-collector` skill/agent.
- Token economy and model routing: `.claude/skills/metaframer-token-economy/SKILL.md` and
  `token-economy-policy.json`.
- Roadmap and current-truth state: `planning/roadmap-v1-current-truth.json`, projected in
  `ROADMAP.md`.
