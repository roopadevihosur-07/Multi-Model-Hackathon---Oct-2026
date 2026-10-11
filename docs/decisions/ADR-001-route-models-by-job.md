# ADR-001: Route each job to the cheapest model that does it well
Status: accepted
Context: One strong model doing every job costs ~5x more per hour of conversation.
Decision: Map updates and alert checks use a fast, cheap model (Gemini Flash-Lite). Recaps use a reasoning model (Claude Sonnet). The alert model only runs after a free text check finds the user's name plus a question.
Consequences: Every model call must be logged in the cost ledger. New model calls must name the role they fill.
