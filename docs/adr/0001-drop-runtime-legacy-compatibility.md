# Drop Runtime Legacy Compatibility

Future refactors will no longer keep permanent runtime compatibility branches for legacy configuration, legacy storage structures, or deprecated interfaces. We accept deleting such code outright and treating the data structures and behavior of the current version as the single source of truth. If data ever needs to be preserved, solve it with a one-off migration script or import tool instead of keeping compatibility logic in the main path.
