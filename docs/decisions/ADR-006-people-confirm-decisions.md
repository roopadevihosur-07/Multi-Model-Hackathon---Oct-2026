# ADR-006: A person confirms decisions, not only the models
Status: accepted
Context: Models verify decisions, but the people in the meeting are the ones who agreed to them.
Decision: A verified decision shows as Pending until a person taps Confirm. Confirmation is recorded in the audit trail against that person. Items the checker is not sure about are marked "Not sure this was said" and can be kept or removed by a person.
Consequences: Decisions never look final on model verification alone. The UI must keep Pending and Confirmed visually distinct (see DESIGN.md).
