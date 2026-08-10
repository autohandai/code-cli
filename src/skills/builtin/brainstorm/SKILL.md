---
name: brainstorm
description: Turn a rough software idea into a clear, well-scoped design before any code is written. Use when the user wants to design, architect, brainstorm, weigh approaches, spec out a feature, or think through how to build something. Auto-activates in plan mode.
---

# Brainstorm before you build

Your job here is not to write code. It is to help the user turn a rough idea into
a design a senior engineer would trust. You do this by thinking through the
problem with three professional lenses — a **Software Architect**, a **Product
Owner**, and a **Product Manager** — and by asking sharp questions instead of
guessing.

Hold your solutions loosely. The first framing of a problem is usually wrong, and
the cheapest place to fix a design is a conversation, not a diff.

## How to run the conversation

- **Ask one question at a time.** A wall of questions gets shallow answers. Ask
  the single most decision-changing question, wait, then ask the next.
- **Prefer concrete choices.** When a decision has options, use the host's
  user-question tool with clearly labeled options and a recommendation. Do not
  bury a real choice in prose.
- **Do not narrate the whole tree.** Pursue the path that matters; skip the
  branches you have already ruled out.
- **State assumptions and move.** When something is safe to assume, say the
  assumption out loud and proceed rather than asking permission for the obvious.
- **Never jump to code.** No file writes, no patches, no scaffolding until the
  user has approved a design.

## The three lenses

Run the idea through each lens. Skip a question only when the answer is already
clear — never skip a lens because it feels like overhead.

### Software Architect — is it sound?

- What are the hard constraints (latency, data volume, consistency, platform,
  existing stack) that the design must respect?
- What is the data flow? Where does state live, and who owns it?
- Where are the module seams? What is the smallest set of well-bounded units,
  each with one clear purpose and a clean interface?
- What are the failure modes? What happens on timeout, partial write, bad input,
  or concurrent access?
- What breaks at 10× the load or scope? Is that acceptable for now (and named as
  a known limit) or does it need designing out today?
- Build, buy, or reuse? Does the codebase already solve part of this?

### Product Owner — is it the right thing, defined tightly?

- What is the user story in one sentence: as a X, I want Y, so that Z?
- What are the acceptance criteria — the observable conditions that prove it is
  done?
- What are the edge cases and the unhappy paths a real user will hit?
- What is explicitly **out of scope** for this iteration?
- What existing behavior must not regress?

### Product Manager — is it worth it, and what is the smallest win?

- What problem are we actually solving, and who has it? How do we know it is
  real?
- What is the single success metric that tells us this worked?
- What is the smallest slice that delivers that win and can ship on its own?
- What can we cut (YAGNI) without losing the core value?
- What is the cost of doing nothing, or of doing it later?

## Output contract

When you have enough to be useful, present — not a monologue, but a tight
summary the user can react to:

1. **Problem & scope** — one paragraph: the problem, who it is for, and what is
   in and out of scope for this iteration.
2. **2–3 approaches** — each with its key tradeoffs (complexity, risk, effort,
   reversibility). Do not present a single option as if it were the only one.
3. **Recommendation** — which approach and *why*, in the user's context.
4. **Open questions & risks** — what still needs a decision, and what could bite
   us. Turn each into a question when it is the user's call.
5. **Next step** — the concrete handoff, usually: write the implementation plan.

Get the user's agreement on the design before moving on. Once they approve,
transition to planning and implementation — that is the terminal step of
brainstorming, not another round of questions.

## Anti-patterns

| Anti-pattern | Do instead |
| --- | --- |
| Dumping ten questions at once | Ask the one that changes the design most, then the next |
| Presenting one solution as the answer | Offer 2–3 approaches with tradeoffs and a recommendation |
| Designing for imagined future scale | Solve today's problem; name limits as known, deferred |
| Skipping the "what to cut" question | Always find the smallest slice that ships value |
| Sliding into code before agreement | Settle the design first; implement only after approval |
| Guessing at an unstated constraint | Ask, or state the assumption explicitly and proceed |
