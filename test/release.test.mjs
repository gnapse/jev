import { describe, expect, it } from 'vitest';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import config from '../release.config.mjs';

const options = config.plugins.find(([name]) => name === '@semantic-release/commit-analyzer')[1];
const analyze = messages => analyzeCommits(options, {
  cwd: process.cwd(), logger: { log() {} },
  commits: messages.map(message => ({ message })),
});

describe('release policy', () => {
  it.each([
    ['fix: handle missing credentials', 'patch'],
    ['perf(mcp): reuse the transport', 'patch'],
    ['feat: add a new command', 'minor'],
    ['feat!: remove an old command', 'major'],
    ['fix(api): change response shape\n\nBREAKING CHANGE: results now use named fields.', 'major'],
    ['docs: clarify login', null],
    ['ci: configure publishing', null],
    ['chore: update dependencies', null],
  ])('%s yields %s', async (message, expected) => {
    expect(await analyze([message])).toBe(expected);
  });

  it('uses the highest release type across all commits', async () => {
    expect(await analyze(['fix: retry requests', 'feat: add a command'])).toBe('minor');
    expect(await analyze(['feat: add a command', 'fix!: change the output'])).toBe('major');
  });

  it('renders release notes with the installed conventional-commits preset', async () => {
    const notesOptions = config.plugins.find(([name]) => name === '@semantic-release/release-notes-generator')[1];
    const notes = await generateNotes(notesOptions, {
      cwd: process.cwd(), options: { repositoryUrl: 'https://github.com/gnapse/jev' },
      lastRelease: { gitTag: 'v0.1.1' }, nextRelease: { version: '0.1.2', gitTag: 'v0.1.2' },
      commits: [{ hash: 'a'.repeat(40), message: 'fix: handle missing credentials' }],
    });
    expect(notes).toContain('handle missing credentials');
    expect(notes).toContain('https://github.com/gnapse/jev/compare/v0.1.1...v0.1.2');
  });
});
