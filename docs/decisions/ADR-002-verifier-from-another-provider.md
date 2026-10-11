# ADR-002: Decisions and tasks are verified by a different provider
Status: accepted
Context: A model checking its own output repeats its own mistakes.
Decision: The verifier must use a different provider from the mapper. Only items with verdict "supported" are shown as verified; "not agreed" items become open questions; "unsupported" items are removed.
Consequences: Decisions and tasks must never be displayed as final before verification.
