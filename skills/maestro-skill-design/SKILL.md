---
name: maestro-skill-design
disable-model-invocation: true
description: Design, migrate, or validate a Maestro project Skill with linked
  Markdown, a Session/Run contract where needed, and reproducible host cases.
allowed-tools:
  - Bash
  - Edit
  - Glob
  - Grep
  - Read
  - Write
session-mode: none
version: 0.5.93
---

# Maestro Skill Design

Use the requested outcome and the target project's conventions to design or validate `skills/<id>/SKILL.md` and its package. This Skill is entered explicitly when the Agent Memory knowledge route classifies a verified candidate as `skill-design`, or when the user directly requests a new Skill. A route decision alone never starts this Skill. When migrating an existing Skill, inventory its entry points, parameters, outputs, and recovery paths before moving guidance. Keep those interfaces in the design and exercise them in acceptance cases.

1. Resolve the project's knowledge and applicable constraints. Record the Skill's triggers, expected artifacts, effects, and success cases. Choose Session/Run when the task needs durable progression, decisions, or artifact handoff. A standalone Skill can use the host's completion receipt. Reuse any Run already assigned to the authoring task.
2. Put dispatch rules and short instructions in `SKILL.md`. Move conditional procedures into package-relative Markdown links. Put scripts and role instructions beside the Skill when it owns them. Use [the package contract guide](references/package-contract.md) when choosing the lifecycle or declaring Run inputs, outputs, and linked documents.
3. Inspect the package as the host will see it. Validate the intended Git revision and test the main workflow, one existing success case, and each affected recovery or conditional branch. For a plan or review request, deliver the design or identified gaps. For authoring, leave the requested files and verification results in the workspace.
4. For changes motivated by a finished Session, use its Memory retrospective to ground the change. Follow [the replay and release procedure](references/validation.md) to verify the actual loaded version and preserve a rollback path.
