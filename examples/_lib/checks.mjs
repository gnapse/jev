// Deliberately broad demo expectations. These are opt-in live checks, not CI tests.
export function compare(answers, expected) {
  return Object.entries(expected).map(([question, target]) => {
    const answer = answers[question];
    const actual = answer?.type === 'choice' ? answer.choice
      : answer?.type === 'noul' ? answer.noul : answer?.score;
    const pass = typeof target === 'boolean'
      ? typeof actual === 'number' && (target ? actual >= 0.75 : actual <= 0.25)
      : typeof target === 'string' ? actual === target
      : typeof actual === 'number' && actual >= target.min && actual <= target.max;
    return { question, expected: target, actual, pass };
  });
}
