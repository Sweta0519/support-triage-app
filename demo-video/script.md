# Support Triage: product video (every feature)

About 2:15. The narration, captions and timing live in `build.py` (`SCENES`); the
browser actions and camera moves in `record.mjs`. This page is the overview.

**Look:** the app floats as a window (rounded corners, soft shadow) on a deep indigo
gradient. The camera glides in to what matters (a panel, a menu, Sage) and back out.
Each section opens with a headline card; the montage captions every shot. Animated
title and closing cards, a click ripple on the cursor, crossfades between scenes, and
a calm generated music bed (pad, plucked arpeggio, soft kick) that ducks under the voice.

| # | Section | On screen (camera) | Narration |
|---|---------|--------------------|-----------|
| 1 | Title | Logo, "Support Triage", "Every ticket, understood in seconds." | Every support ticket starts with the same questions… Support Triage answers them in seconds. |
| 2 | The customer | Customer fills the new-ticket form (zoom on the form), submits | A customer writes in. |
| 3 | AI triage | The AI panel: fields (zoom), "Still needed", the drafted reply, model and cost | Before anyone opens it, the AI has read it… Every run shows its model, and what it cost. |
| 4 | Sage | On the same ticket: open Sage (zoom on the chat), ask the refund policy, it answers from the "Refund policy" note and cites it | Need the policy? Ask Sage, your private assistant… |
| 5 | Human in the loop | Correct the priority (zoom on the review), claim, use the suggested reply, send | The AI only suggests… Nothing reaches a customer without a person. |
| 6 | The queue | SLA stat cards and an "At risk" card (zoom), the card's ⋯ menu (zoom), flag to follow up | The queue keeps the team on time… |
| 7 | The board | Drag the ticket to In progress (zoom on the column) | Prefer a board? Drag and drop. |
| 8 | Learning | #4190: "✦ Used 2 past corrections as examples" expanded (zoom), "Don't learn from this" | And it learns… |
| 9 | Incidents | Banner (zoom) → INC-30 → the AI-drafted update and its two-step post (zoom), then Cancel | When many customers hit the same problem… |
| 10 | Analytics | Stat cards (zoom), "Is the AI learning?" (zoom), team performance | Analytics show response times… |
| 10b | MCP | An AI assistant's terminal (zoom): "What's waiting for me?", real `list_queue` and `get_ticket` calls to `/api/mcp` as the test admin, the three most urgent unassigned tickets, and the AI's draft reply marked "not sent" (zoom) | Prefer to work from your AI assistant? Connect Claude Code, Cursor or VS Code… a draft is only a draft until you send it. |
| 11 | Montage | ~2 s each, captioned: file for a customer, 5-star rating, public status page, labels, re-run AI, admin overview, dark theme, sign-in, privacy policy | One line per shot ("Agents file tickets for customers…", "…with a clear privacy policy, and your data under your control.") |
| 12 | Close | Logo, "The AI does the reading. Your team does the helping." | Support Triage. The AI does the reading… |

The MCP scene's terminal is a plain styled page, not any one product's interface. Its tool calls are real, made with a token that the scene creates for the test admin and revokes straight after; the assistant's sentences are put together from what the tools returned.

Not shown: the "AI triage is off/failing" banner and a stalled run (both need a real outage).

## Making it

```bash
node --env-file=.env.local scripts/backdate-demo.mjs --apply   # fresh SLA states
npm run build && npm run start                                  # in another terminal
node --env-file=.env.local demo-video/record.mjs                # ~10 min, real AI calls
/usr/bin/python3 demo-video/build.py                            # ~10 min
```

Recording uses the test accounts, so don't run it at the same time as the Playwright
suite. Staff scenes use the test admin (a real display name, no test fixtures on screen);
the montage's theme switch uses the test agent and is put back afterwards.
