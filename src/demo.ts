// A rehearsed product meeting. It plants the three demo moments:
//  1. a question aimed at the user (Alex)       -> "They're asking you" alert
//  2. an idea floated but not agreed (line 8)     -> verifier turns it into an open question
//  3. real decisions and owned tasks              -> verified with a check mark
export const DEMO_SPEAKERS = ["Priya", "Marcus", "Alex"];

export const DEMO_SCRIPT: { speaker: string; text: string; seconds: number }[] = [
  { speaker: "Priya", text: "Okay, let's talk about the mobile app launch. We're aiming for the 24th.", seconds: 5 },
  { speaker: "Marcus", text: "The payment screen still crashes on older Android phones, that's my biggest worry.", seconds: 6 },
  { speaker: "Priya", text: "How many users are on those older phones?", seconds: 3 },
  { speaker: "Marcus", text: "About twelve percent, based on last month's analytics.", seconds: 4 },
  { speaker: "Priya", text: "Then let's fix the crash before launch. That's not optional.", seconds: 4 },
  { speaker: "Marcus", text: "Agreed. I'll take the Android crash fix this week.", seconds: 4 },
  { speaker: "Priya", text: "Great. Next, the onboarding flow. Marketing wants a new welcome video.", seconds: 5 },
  { speaker: "Marcus", text: "Maybe we move the launch to the 31st to fit the video in.", seconds: 4 },
  { speaker: "Priya", text: "Hmm, I'm not sure about that, let's keep thinking.", seconds: 4 },
  { speaker: "Marcus", text: "What about using the old video for now and swapping it later?", seconds: 4 },
  { speaker: "Priya", text: "Alex, can you own the deadline update for the leadership email?", seconds: 4 },
  { speaker: "Alex", text: "Sure, I'll send the update to leadership by Thursday.", seconds: 4 },
  { speaker: "Priya", text: "Perfect. So we're decided: launch on the 24th with the old video.", seconds: 5 },
  { speaker: "Marcus", text: "Sounds good to me.", seconds: 2 },
];
