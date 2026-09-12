> Synthetic company note for the Fork demo. Not a real policy.

# Sample task board constraints

The sample task table uses synthetic records with due dates in both the past and the future, so that
filters have something to show without touching a backend.

Overdue means the due date is earlier than today. Filters are client-side only: no query parameters,
no server round trip, and no schema changes during a demo.

Owners are drawn from a short list of fictional names. Status values are Open, In progress, and Done.
Urgency is a separate flag from status, and an urgent request can be in any status.

Prototypes may add columns, filters, and empty states. They may not add real integrations, real
notifications, or persistence beyond the demo workspace.
