# Read-only Odyssey audit artifacts

Resume the exact Maestro Run, then read `outputs/session.json` for the audit phase, target, tier and findings already recorded. Store audit progress in that file and keep lifecycle state in the Maestro Run Store.

Use the selected mode's artifact contract for `kind`, `schema`, `role` and `alias`. Put those fields in `_meta` for `session.json` and, in Defensive mode, `anchors.json`. Put `_meta` in the first record of `evidence.ndjson` and append subsequent observations. Put the report metadata in the YAML frontmatter of `understanding.md`.

At report time, reconcile the severity counts with the evidenced findings. Record unverified categories and unresolved reviews explicitly. Check that the audited files have the same bytes as at intake before sealing with `maestro run check` and the active Run's continuation.
