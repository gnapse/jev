import { readFile } from 'node:fs/promises';
import { extractEmail } from './extract.mjs';

try {
  if (process.argv.length > 3) throw new Error('Usage: node examples/extract-email/run.mjs [FILE|-]');
  const path = process.argv[2];
  let document;
  if (path && path !== '-') document = await readFile(path, 'utf8');
  else {
    if (process.stdin.isTTY) throw new Error('Supply a text file or pipe text into stdin.');
    document = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) document += chunk;
  }
  console.log(JSON.stringify(await extractEmail(document), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
