# dottie — DESIGN.md

> Never lose the thread.

A live conversation map for neurodivergent people. The design goal above everything else is **low sensory load**: the user is already overwhelmed by a fast conversation, so the screen must be calm, predictable and readable at a glance. Only one thing is ever allowed to shout: the "It's your turn" alert.

Inspired by the Perplexity (calm parchment, single accent) and Notion (muted pill tags) styles on Refero. Use them as inspiration only. Don't copy their logos, wordmarks or layouts.

---

## 1. Principles

1. **Calm by default.** Warm off-white canvas, flat cards, two font weights, no gradients, no shadows beyond a hairline.
2. **One accent, one alarm.** Teal marks "active / confirmed." Amber is reserved only for the "It's your turn" alert. Nothing else uses amber.
3. **Never color alone.** Every state also has a word or an icon (Pending, Confirmed, Not sure).
4. **Nothing jumps.** New items fade in. Existing items never reflow under the user's eye. No flashing, no bouncing.
5. **The human decides.** Pending and confirmed must look clearly different, because the human confirms decisions.

---

## 2. Color tokens

The tokens live in `public/styles.css` as `--tl-*` custom properties, with a dark palette under `prefers-color-scheme: dark`.

- Surfaces: canvas `#faf8f5`, surface `#fdfbfa`, border `#d1d1cd`
- Text: ink `#27251e`, graphite `#72706b`, ash `#92918b`
- Accent (active / confirmed): teal `#016a71`, tint `#e3f0f0`
- Alarm ("It's your turn" only): amber `#ffb110`, tint `#fff4dc`
- Pills: decision (teal family), question (soft lavender), action (soft sage), topic/idea (warm sand)

**Contrast:** body text and pill text should meet WCAG AA (4.5:1). Check any tint you change.

---

## 3. Typography

- **Font:** Inter (fallback: system-ui, -apple-system, sans-serif)
- **Weights:** 400 and 500 only. No bold display type.
- **Minimum size:** 16px for anything the user must read during the conversation.

| Token | Size / line height | Use |
|---|---|---|
| alert | 22px / 1.3, weight 500 | "It's your turn" banner |
| title | 18px / 1.4, weight 500 | Topic bubble titles |
| body | 16px / 1.5, weight 400 | Map items, recap text |
| label | 14px / 1.43, weight 500 | Pills, buttons |
| meta | 12px / 1.33, weight 400 | Speaker names, timestamps |

---

## 4. Spacing, shape, motion

- **Base unit:** 4px. Scale: 4, 8, 12, 16, 24, 32, 48.
- **Card padding:** 16px. **Gap between items:** 8px. **Gap between topic bubbles:** 24px.
- **Radius:** cards and bubbles 16px · buttons 12px · ghost buttons 8px · pills 9999px.
- **Elevation:** flat. Hairline borders only. One exception: the alert banner uses `0 4px 12px rgba(0,0,0,0.08)`.
- **Motion:** 200ms ease-out fades only. New items fade in at their final position. No flashing, shaking, bouncing, or auto-scrolling the map.
- **Reduced motion:** `prefers-reduced-motion` turns all transitions and animations off.

---

## 5. Components

### Topic bubble
- Surface background, 1px border, 16px radius, 16px padding.
- Title with a small topic icon to the left.
- Items listed inside, each with its type pill.
- **Active topic** (the latest one with an item): 2px teal left border plus a small "Now" label. No glow, no pulse.

### Item type pills
Pill, icon + word, always:

| Type | Icon | Colors |
|---|---|---|
| Decision | check-circle | decision tint / teal |
| Question | help-circle | question tint / lavender |
| Action item | arrow-right-circle | action tint / sage |

### Pending vs. confirmed decision (human in the loop)
- **Pending:** 1px dashed outline, transparent fill, label "Pending", plus a **Confirm** button and an **×** to dismiss.
- **Confirmed:** solid teal-tint fill, check icon, label "Confirmed." No button.

### "Not sure this was said" (checker flag)
- Item text in graphite with a dotted underline.
- Helper text: "Not sure this was said."
- Two quiet buttons: **Keep** / **Remove**. Never red.

### "It's your turn" alert (the only loud thing)
- Full-width banner pinned to the top, amber tint background, 4px amber left border, 16px radius.
- Text: "[Name] is asking you:" then the question, in the alert size.
- Below: one line of context ("They were discussing …").
- Buttons: **Catch me up** (filled) and **Got it** (ghost).
- Stays until dismissed; never auto-hides. Optional short vibration on phones; no sound.

### Buttons
- **Filled (primary):** ink background, canvas text, 12px radius, min height 44px.
- **Ghost:** transparent, graphite text, 1px border, 8px radius, min height 44px.
- **Accent** (Confirm only): teal background, white text.
- All tap targets are at least 44 × 44px.

### Bottom control bar (always visible)
- **Catch me up** (filled) · **What did I miss?** (ghost) · **That's wrong** (ghost).
- Recording indicator at the far left: teal dot and "Recording". Tapping it pauses.

### Catch-me-up panel
- Slides up from the bottom, max 3 points plus the topics they belong to.
- Closes with **Got it**. Never covers the alert banner.

### Calm mode toggle
- Top-right switch. When on: hides topics and action items, shows only decisions and questions.

### Consent screen (before recording)
- Centered card: "Everyone in this conversation should know it's being mapped." Primary button **Everyone agreed: start**. Ghost button **Cancel**.

---

## 6. Layout

- **Desktop / projector:** map fills the screen as a calm grid of topic bubbles. Alert banner pinned at the top. Control bar pinned at the bottom.
- **Phone:** single column of topic bubbles. Same alert and control bar.
- New topics are added at the **end** of the grid; existing bubbles never move.

---

## 7. Do / Don't

**Do**
- Keep the canvas parchment, cards soft paper, borders hairline.
- Use teal only for active, confirmed and the Confirm button.
- Use amber only for "It's your turn."
- Pair every color with a word or icon.
- Keep text at 16px or larger during live use.

**Don't**
- Add new accent colors, gradients, glows or heavy shadows.
- Use red anywhere; mistakes are corrected calmly, not flagged as errors.
- Animate anything faster than 200ms or let the map reflow.
- Use bold display type or more than two font weights.
- Auto-dismiss the alert or auto-share anything.

---

## 8. Demo checklist
- [ ] Map builds calmly, topics fading in
- [ ] Amber "It's your turn" banner with context
- [ ] "Catch me up" panel
- [ ] A pending decision tapped to Confirmed
- [ ] A "Not sure this was said" item removed
- [ ] Recording indicator and consent screen
