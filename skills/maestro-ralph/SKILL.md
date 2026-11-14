---
name: maestro-ralph
disable-model-invocation: true
description: Compatibility entry for legacy Maestro closed-loop execution
argument-hint: <intent> [-y] [-c] [--amend]
allowed-tools:
  - Bash
  - Read
  - request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
version: 0.5.93
---

<required_reading>
@~/.maestro/workflows/run-mode.md
@~/.maestro/workflows/codex-run-mode.md
</required_reading>

Load the registered Maestro entry for this host and execute its instructions once with legacy Ralph invocation identity, the original intent, and the original flags. Retain the original authorization, Session selection, amendment, bounded recovery and final decision requirements. This entry does not create a Session or dispatch a Run independently.
