# Agent prompt system

The agent's instructions live in `src/lib/agent-prompt.ts` as an ordered list
of named sections (`AGENT_PROMPT_SECTIONS`). Each rule belongs to exactly one
section, so rules never stack in overlapping layers.

To add a new behaviour later:
1. find the section it belongs to and add one line there, or
2. append a new `{ id, title, rules }` entry to `AGENT_PROMPT_SECTIONS`
   (before `INVENTORY_SECTION_ID` if it is behaviour, after if it is data).

Never duplicate a rule across sections.
