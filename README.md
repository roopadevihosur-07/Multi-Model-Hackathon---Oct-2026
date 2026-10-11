# Live Map

A live, verified visual map of the conversation you're in, so neurodivergent people can take part while it happens, not just catch up afterwards.

Built for the Multi Model Hackathon, SF Tech Week 2026.

## Run it

```bash
npm install
cp .env.example .env     # add whichever keys you have
npm start                # http://localhost:3000
```

No keys? It still runs end to end in **simulated mode**, using local rules in place of the models, so the demo never breaks.

## Demo

1. Open the page and click **Watch the live demo**.
2. Tick the consent box and press **Start**, then **Play demo conversation**.
3. A scripted three-person meeting (about 45 seconds) runs through the real model pipeline:
   - the map grows by topic, with decisions, tasks, questions and ideas
   - decisions and tasks show **checking**, then **verified** once a second provider confirms them
   - "Maybe we move the launch to the 31st" is downgraded to **not agreed** because nobody agreed
   - when Priya asks Alex a question, the **"Priya is asking you"** alert appears with context
4. Tap any card to see the exact quote. Try **Catch me up**, **That's wrong**, **Audit trail** and **Routing**.

Live mode uses Deepgram streaming with speaker labels if `DEEPGRAM_API_KEY` is set, or Chrome's built-in speech recognition otherwise.

## Models and why

| Job | Model | Why |
| --- | --- | --- |
| Listen | Deepgram nova-3 streaming, speaker labels | Real time, knows who spoke |
| Alert check | Free text match, then Gemini 2.5 Flash-Lite | Fast; only runs when your name and a question appear |
| Map updates | Gemini 2.5 Flash-Lite | Cheap enough to run every few seconds |
| Verify | DeepSeek (different provider from the mapper) | No model grades its own work |
| Recaps | Claude Sonnet | Best at turning a messy conversation into calm, short cards |

If a provider's key is missing or a call fails, the router falls back to the next provider for that role. The verifier always prefers a provider different from the one that made the map.

## Architecture

- `src/main.ts`: Node HTTP server, API routes, static files. Uses relative URLs so it works behind Anbaric's `/app/<n>/` proxy.
- `src/models.ts`: provider calls (Gemini, DeepSeek, Anthropic), routing with fallbacks, and Deepgram short-lived tokens.
- `src/pipeline.ts`: alert, mapper, verifier and recap loops, the cost ledger, and the audit trail. Every model is a named actor.
- `src/demo.ts`: the scripted demo meeting.
- `public/`: landing page and live session UI (plain JS, no build step).
- `docs/decisions/`: ADRs that Prelint reviews pull requests against.

## Deploy on Anbaric

```bash
npm install -g anbaric-cli
anbaric login
anbaric app deploy        # uses .anbaric/app-config.json; promo code SFTW26
```
Set the API keys as environment variables in the Anbaric app settings.
