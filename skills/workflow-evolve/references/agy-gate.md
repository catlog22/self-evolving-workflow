# Agy gate

Every round has two Agy calls.

## Discussion response

The first call receives the baseline observations and history review. It must return JSON with this shape.

```json
{
  "approved": true,
  "priority": "high|normal|low",
  "instruction": "one concise Skill instruction",
  "when": "optional trigger for normal or low priority guidance",
  "evidence": ["receipt or verification reference"],
  "rationale": "why the change is attributable and minimal",
  "needs_revision": []
}
```

`approved` means the suggestion is ready to turn into a draft. Agy must set it to `false` when the evidence is missing, the change is broader than the observed failure, or the request needs a new Skill contract. Contract changes route to `maestro-skill-design` after the loop.

## Confirmation response

The second call receives the draft and the complete replay receipt. It must return `approved`, `reason` and `required_changes`. It approves only when every baseline pass remains green, every requested failure is fixed, the candidate loaded the expected Skill documents, and the evidence is traceable to the reviewed execution.

The loop stores both responses under the round directory. `--auto` applies a receipt after this second call returns `approved: true`. Agy owns the evaluation decision for each proposed change.
