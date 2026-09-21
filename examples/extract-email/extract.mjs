import { ask } from '../_lib/cli.mjs';

export const policy = { minimumProbability: 0.85, minimumMargin: 0.25 };

export function buildRequest(document, model = 'jev-1.13.0') {
  // A small demonstration matcher, not a complete email-address parser.
  const candidates = [...new Set(document.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])];
  if (!candidates.length) return { candidates, request: null };
  // Reserve two options for absent and ambiguous destinations.
  if (candidates.length > 253) throw new Error('Too many candidates; narrow the document first.');
  const criteria = Object.fromEntries(candidates.map((email, index) => [
    `email_${index}`, { email, meaning: 'The sender specifically requests this address for the receipt' },
  ]));
  criteria.none = 'The document does not request that a receipt be sent to any listed email address';
  criteria.unclear = 'The document requests a receipt by email but leaves more than one possible destination without choosing one';
  return { candidates, request: { model, state: { document }, questions: {
    destination: { type: 'choice',
      instructions: 'Which email address does the sender ask to receive the receipt? Read `document` for the requested role. Headers or contact details alone do not specify a receipt destination. Use none if no listed address is requested, and unclear if the request leaves competing destinations.',
      criteria },
  } } };
}

export function interpret(candidates, response) {
  const answer = response.answers.destination;
  const selected = answer.probabilities[answer.choice];
  const runnerUp = Math.max(0, ...Object.entries(answer.probabilities)
    .filter(([label]) => label !== answer.choice).map(([, probability]) => probability));
  const confident = selected >= policy.minimumProbability && selected - runnerUp >= policy.minimumMargin;
  const index = /^email_(\d+)$/.exec(answer.choice)?.[1];
  const candidate = index === undefined ? undefined : candidates[Number(index)];
  const status = candidate !== undefined && confident ? 'selected'
    : answer.choice === 'none' && confident ? 'not_found' : 'review';
  // Copy the original match; never ask the model to retype or normalize a value.
  return { status, email: status === 'selected' ? candidate : null,
    candidates, policy, response };
}

export async function extractEmail(document, model) {
  const { candidates, request } = buildRequest(document, model);
  if (!request) return { status: 'not_found', email: null, candidates, policy, response: null };
  return interpret(candidates, await ask(request));
}
