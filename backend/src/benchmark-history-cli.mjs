import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { baselineBenchmarkHistory, createBenchmarkHistoryStore } from './benchmark-history.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const inputPath = argument('--input');
const historyPath = argument('--history');
if (!inputPath || !historyPath || !basename(inputPath).endsWith('.json')) {
  throw new Error('Usage: node benchmark-history-cli.mjs --input <local-result.json> --history <local-history.jsonl>');
}

// This CLI deliberately has only local filesystem capability. It never opens a network connection.
const candidate = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const store = createBenchmarkHistoryStore({
  filePath: resolve(historyPath),
  reservedIds: baselineBenchmarkHistory.map((item) => item.id),
});
const appended = await store.append(candidate);
console.log(JSON.stringify({ status: 'appended', id: appended.id }));
