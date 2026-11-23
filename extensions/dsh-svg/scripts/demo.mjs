import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from '../test/helpers.mjs';
const f = await fixture();
try {
  const calls = JSON.parse(await readFile('examples/approval-tools.json', 'utf8'));
  const results = [];
  for (const call of calls) {
    const result = await f.run(call.tool, call.args, 'approval-demo');
    assert.equal(result.isError, false, JSON.stringify(result));
    results.push({ ...call, result });
  }
  const exported = results.at(-1).result.value;
  assert.match(exported.svg, /人工审批/);
  assert.match(exported.svg, /fill="#f5a623"/);
  assert.match(exported.svg, /id="review-rect" x="350" y="100"/);
  assert.equal(exported.undoCount, 8);
  assert.equal(exported.redoCount, 1);
  await writeFile('examples/approval.svg', exported.svg);
  await writeFile('examples/tool-transcript.json', JSON.stringify({
    runtime: { cordis: '4.1.0', tools: '0.2.2-rc.5', executor: 'official native',
      apiKeysRequired: false, modelCallsMade: false, sessionLogPersisted: false },
    calls: results,
  }, null, 2) + '\n');
  console.log(`DSH official native execution passed: ${results.length} calls; examples/approval.svg and tool-transcript.json written.`);
} finally { await f.dispose(); }
