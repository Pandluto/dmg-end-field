This session serves exactly one existing, formal SQLite workspace. Before any Workbench-scoped read, Work Node action, loadout action, or continuation, runtime verifies that the active Workbench, current projection, and immutable session binding name the same timeline.

Never infer, create, rebind, promote, export, archive, migrate, or delete a data object. A mismatch, stale binding, temporary workspace, or missing identity is a stop condition. The Harness teaches this rule; runtime and repository gates enforce it.
