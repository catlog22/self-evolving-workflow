export const orchestrationSteps = ['companion', 'brainstorm', 'analyze', 'plan', 'execute', 'review'];
export const odysseyModes = ['debug', 'improve', 'planex', 'review', 'security', 'defensive', 'ui'];

const aliases = new Map<string, string>([
  ['maestro', 'ew-orchestrate'],
  ['maestro-odyssey', 'ew-odyssey'],
  ['maestro-skill-design', 'ew-skill-design'],
  ['maestro-impeccable', 'ew-impeccable'],
  ...orchestrationSteps.map(step => [step, 'ew-' + step] as const),
  ...odysseyModes.map(mode => ['odyssey-' + mode, 'ew-odyssey-' + mode] as const),
]);
const historical = new Map([...aliases].map(([old, current]) => [current, old]));
for (const step of orchestrationSteps) aliases.set('maestro-' + step, 'ew-' + step);

export function workflowName(name: string) {
  return aliases.get(name) ?? name;
}

export function historicalWorkflowName(name: string) {
  return historical.get(name);
}
