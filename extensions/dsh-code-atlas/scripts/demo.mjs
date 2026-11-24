import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { DshCodeSource } from '../lib/index.js';
import { AtlasWorkbench } from '../lib/core.js';
import { TypeScriptLanguageProvider } from '../lib/analysis.js';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(extension, '../..');
const ctx = new Context();
const filesystem = await ctx.plugin(LocalFileSystem, {});
const workbench = new AtlasWorkbench(new DshCodeSource(ctx.fs), new TypeScriptLanguageProvider());
try {
  const initial = await workbench.scan('example', project);
  const contract = initial.snapshot.nodes.find(node => node.name === 'AttributeHandler' && node.kind === 'interface');
  const box = initial.snapshot.nodes.find(node => node.name === 'BoxAttributes' && node.kind === 'class');
  assert(contract && box, 'The demonstration project must contain the real interface and box implementation.');
  const relation = initial.snapshot.relations.find(edge => edge.from === box.id && edge.to === contract.id && edge.kind === 'implements');
  assert(relation?.resolved, 'BoxAttributes must resolve implements AttributeHandler.');
  const inspected = await workbench.inspect('example', box.id);
  assert.match(inspected.source.content, /implements AttributeHandler/);
  await workbench.markRead('example', box.id, true);
  const dependencies = workbench.route('example', 'dependencies', 1);
  await mkdir(resolve(extension, 'examples'), { recursive: true });
  await writeFile(resolve(extension, 'examples/box-attributes.svg'), dependencies.svg);
  await workbench.inspect('example', contract.id);
  const users = workbench.route('example', 'users', 1);
  assert(users.graph.nodeIds.includes(box.id));
  await writeFile(resolve(extension, 'examples/attribute-handler.svg'), users.svg);
  await writeFile(resolve(extension, 'examples/analysis-record.json'), JSON.stringify({
    method: 'Real rc.1 LocalFileSystem and AtlasWorkbench, without a model or Desktop UI',
    files: initial.snapshot.nodes.filter(node => node.kind === 'file').length,
    nodes: initial.snapshot.nodes.length, relations: initial.snapshot.relations.length,
    evidence: relation, box: { id: box.id, file: box.file, line: box.location.startLine },
    read: dependencies.readIds.includes(box.id), usersContainBox: users.graph.nodeIds.includes(box.id),
  }, null, 2) + '\n');
  console.log(`Generated source-backed examples: ${initial.snapshot.nodes.length} nodes; implements evidence at ${relation.location.file}:${relation.location.startLine}.`);
} finally { workbench.dispose(); await filesystem.dispose(); }
