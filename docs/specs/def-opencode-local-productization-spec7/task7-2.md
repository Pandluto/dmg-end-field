# Task 7-2: Persist Workbench Session Axis-Tree Bindings

## Goal

Make a Workbench conversation bind to a persisted timeline document and its Work Node tree in SQLite. A Work Node remains a flexible checkout or draft, not the durable identity of the conversation.

## Model

```text
Workbench conversation
  -> persistent session-axis binding
  -> timeline document (axis)
  -> Work Node tree
  -> current checkout and optional node pin
```

The transient OpenCode session ID may change after recovery. Its persistent session-axis binding must remain stable and restore the same timeline tree context.

## Scope

- Persist a Workbench session-to-timeline binding in the timeline SQLite repository.
- Keep the active checkout as a tree projection, with the bound node as an optional session cursor rather than the conversation identity.
- Project the timeline document, compact Work Node tree, checkout, and session binding into the bounded Workbench context used by DEF tools.
- Preserve or migrate the binding when a native session is recovered after an OpenCode restart.
- Remove the ambiguity that currently makes a valid tree appear as an unbound Work Node session.

## Non-goals

- A Work Node does not become immutable or permanently owned by one conversation.
- This task does not alter the existing approval, validation, diff, or checkout rules.
- This task does not expose an unbounded repository dump to the model.

## Completion

- A Workbench conversation can identify its persisted axis/tree after restart or native-session recovery.
- The context reports the active checkout and a compact tree summary from SQLite.
- A new draft forks from the bound axis tree's current checkout when no node is explicitly selected.
