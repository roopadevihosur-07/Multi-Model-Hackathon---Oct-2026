# ADR-001: Route each job to the cheapest model that does it well
Status: accepted
Context: The map and the checker run every few seconds; recaps run only when asked. One strong model doing every job pays strong-model prices for the frequent jobs too. The Evals tab shows the measured ratio for each session.
Decision: Map updates and alert checks use a fast, cheap model (Gemini Flash-Lite). Checking decisions and tasks uses a small model from a different provider (Claude Haiku, low effort). Recaps and the overview use Claude Sonnet. The alert model only runs after a free text check finds the user's name plus a question.
Consequences: Every model call must be logged in the cost ledger. New model calls must name the role they fill.
