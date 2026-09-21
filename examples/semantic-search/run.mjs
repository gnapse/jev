import { search } from './search.mjs';

try {
  const [query, ...paths] = process.argv.slice(2);
  if (!query || !paths.length) throw new Error('Usage: node examples/semantic-search/run.mjs QUERY FILE...');
  console.log(JSON.stringify(await search(query, paths), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
