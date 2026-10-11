# dottie

A live, verified visual map of the conversation you're in, so neurodivergent people can take part while it happens, not just catch up afterwards.

**Tagline:** The live map of every conversation.

<u>**[Live landing page: roopadevihosur-07.github.io/Multi-Model-Hackathon---Oct-2026](https://roopadevihosur-07.github.io/Multi-Model-Hackathon---Oct-2026/)**</u>

Built for the Multi Model Hackathon, SF Tech Week 2026.

## Run it

```bash
npm install
cp .env.example .env     # then add the keys you have to .env (never to .env.example)
npm start                # http://localhost:3000
npm test                 # end-to-end test: starts the server offline and runs the demo meeting
```

| Key | Used for | Needed? |
| --- | --- | --- |
| `GEMINI_API_KEY` | Map updates and the alert check | Recommended |
| `ANTHROPIC_API_KEY` | Checking decisions and tasks, recaps, the overview | Recommended |
| `DEEPGRAM_API_KEY` | Live speech with speaker labels | Optional |

With no keys, the app still runs end to end in **simulated mode**, using local rules in place of the models, so the demo never breaks. `.env` is git-ignored; keep real keys there and nowhere else.

## Demo

1. Open the page and click **Watch the live demo**.
2. Tick the consent box and press **Start**, then **Play demo conversation**.
3. A scripted three-person meeting (about 45 seconds) runs through the real model pipeline:
   - the map grows by topic, with decisions, tasks, questions and ideas
   - decisions and tasks show **checking**, then **verified** once Claude confirms them against the transcript
   - "Maybe we move the launch to the 31st" is downgraded to **not agreed** because nobody agreed
   - when Priya asks Alex a question, the **"Priya is asking you"** alert appears with context
4. Tap any card to see the exact quote. Try **Catch me up**, **That's wrong**, **Audit trail** and **Routing**.

## Live meeting

1. Click **Use my microphone**, tick the consent box, and press **Start**.
2. Press **Start listening** and allow microphone access.
3. The status line shows which speech engine is in use:
   - **Deepgram nova-3** when `DEEPGRAM_API_KEY` is set: streams audio and labels each speaker.
   - **Chrome speech recognition** otherwise: works without a key, but cannot tell speakers apart.
4. Every final sentence appears in the **Transcript** drawer straight away. The map is refreshed every 4 seconds in live mode, so cards appear within a few seconds of speech.

## From speech to map

```
 Speech ──► Deepgram nova-3 ──► lines (speaker, text, time)
                                   │
                                   ▼
                     Gemini 3.5 Flash-Lite (mapper)
                     every 4 s, new lines only
                     → topics, decisions, tasks, questions, ideas
                                   │  each item cites the lines it came from
                                   ▼
                     Claude Haiku (checker)
                     decisions and tasks only, low effort
                     → verified · not agreed · pending · unsupported
                                   │
                                   ▼
                         Thread map (the screen)
                                   │
                 on request ──► Claude Sonnet (recap and overview)
```

A sentence that addresses you by name and asks a question also goes through the **alert check** (Gemini, falling back to Claude) so that **"Priya is asking you"** appears straight away.

## Models and why

Each model has one job. The choice balances cost, speed, and independence from the other models.

| Job | Model | Why it was chosen |
| --- | --- | --- |
| Listen | **Deepgram nova-3**, streaming, with speaker labels | Real-time text, and it tells the map who said each line. |
| Listen (fallback) | **Chrome speech recognition** | Free and needs no setup, so live mode still works. It has no speaker labels. |
| Map updates and alert check | **Gemini 3.5 Flash-Lite** | Fast and cheap enough to update the map every few seconds. The alert check only runs when your name and a question appear together. |
| Check | **Claude Haiku 5.5**, low effort | A different provider from the Gemini mapper, so no model grades its own output. Checking runs after every map update, so it uses a model priced like Gemini ($0.10 / $0.50 per million tokens) rather than Sonnet. |
| Recaps and overview | **Claude Sonnet 5.5** | Best at turning a messy conversation into calm, short summaries. Recaps run when you ask; the overview refreshes while its tab is open. |
| Demo and no-key fallback | **Local rules** (simulated mode) | Keeps the demo running without keys. These are rules, not model output. |

If a provider's key is missing or a call fails, the router falls back to the next provider for that job. The checker always prefers a provider different from the mapper.

## Cost and evals

The **Evals** tab shows, for each session:

- **Model calls:** how many calls each model made, its share, tokens in and out, average response time, and spend.
- **Job table:** which models handled each job, and how often.
- **Speech to text:** audio time and spend for each engine, with a log of the latest 50 lines (time, speaker, engine, audio length, confidence, cost).
- **Provider failures:** how often a fallback answered.

Speech cost is an estimate from audio time at the rate in `src/pipeline.ts` (`STT_PER_MIN`). Only Deepgram audio is billed. Chrome speech and the demo are free. Check the rate against Deepgram's current pricing before you rely on it.

## Architecture

- `src/main.ts`: Node HTTP server, API routes, static files. Uses relative URLs so it works behind a proxy prefix. Reads `.env` unless `LIVE_MAP_SKIP_ENV=1`.
- `src/models.ts`: provider calls (Gemini, Anthropic), routing with fallbacks, and Deepgram short-lived tokens.
- `src/pipeline.ts`: alert, mapper, checker, recap and overview loops, the cost ledger, speech usage, and the audit trail. Every model is a named actor.
- `src/demo.ts`: the scripted demo meeting.
- `public/index.html`, `public/styles.css`, `public/landing.js`: the landing page.
- `public/app.js`: the live session UI (plain JS, no build step).
- `tests/e2e.test.ts`: end-to-end test that runs offline.
- `docs/decisions/`: architecture decision records (ADRs).
- `DESIGN.md`: the visual and interaction system (calm by default, one alarm, human confirms decisions).

## Deploy on Anbaric

```bash
npm install -g anbaric-cli
anbaric login
anbaric app deploy        # uses .anbaric/app-config.json
```

Set the API keys as secrets in the Anbaric app settings (`anbaric secrets set <name>`), not in the repository.
