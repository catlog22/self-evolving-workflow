---
name: maestro-next
disable-model-invocation: true
description: Compatibility entry for legacy Maestro routing
argument-hint: <intent> [-y]
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

Load the registered Maestro entry for this host and execute its instructions once with legacy Next invocation identity, the original intent, and the original flags. Use its legacy Next policy to classify and present a route. A confirmed or originally authorized single Run uses the shared lifecycle. Lightweight, multiple-step and campaign routes return the proposed invocation for the user.
