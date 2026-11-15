# Read-only Odyssey audit artifacts

Resume the exact Evolve Run, then read `outputs/session.json` for the audit phase, target, tier and findings already recorded. Store audit progress in that file and keep lifecycle state in the Evolve Run store.

Use the selected mode's artifact contract for `kind`, `schema`, `role` and `alias`. Put those fields in `_meta` for `session.json` and, in Defensive mode, `anchors.json`. Put `_meta` in the first record of `evidence.ndjson` and append subsequent observations. Put the report metadata in the YAML frontmatter of `understanding.md`.

At report time, reconcile the severity counts with the evidenced findings. Record unverified categories and unresolved reviews explicitly. Check that the audited files have the same bytes as at intake, then seal with `evolve run complete` and follow the returned continuation.
