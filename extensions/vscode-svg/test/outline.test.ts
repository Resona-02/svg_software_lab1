import assert from 'node:assert/strict';
import test from 'node:test';
import { SvgOutlineParser } from '../src/outline/SvgOutlineParser.js';
import type { OutlineNode } from '../src/outline/OutlineNode.js';

function names(nodes: readonly OutlineNode[]): unknown[] {
  return nodes.map(node => [node.name, names(node.children)]);
}

test('root, nested groups, leaves and unnamed SVG elements retain source order', () => {
  const source = '<svg id="scene"><g id="outer"><g><rect id="start"/><text>Title</text></g></g><circle/></svg>';
  const outline = new SvgOutlineParser().parse(source);
  assert.deepEqual(names(outline), [['svg#scene', [['g#outer', [['g', [['rect#start', []], ['text', []]]]]], ['circle', []]]]]);
  const root = outline[0]!;
  assert.equal(root.start, 0);
  assert.equal(root.end, source.length);
  assert.equal(source.slice(root.selectionStart, root.selectionEnd), 'svg');
  const rect = root.children[0]!.children[0]!.children[0]!;
  assert.equal(source.slice(rect.start, rect.end), '<rect id="start"/>');
  assert.equal(source.slice(rect.selectionStart, rect.selectionEnd), 'rect');
});

test('one parser instance reflects successive edits, incomplete content and recovery', () => {
  const parser = new SvgOutlineParser();
  assert.deepEqual(names(parser.parse('<svg><rect id="old"/></svg>')), [['svg', [['rect#old', []]]]]);
  assert.deepEqual(parser.parse('<svg><rect id="new'), []);
  assert.deepEqual(names(parser.parse('<svg><g id="new"><circle/></g></svg>')), [['svg', [['g#new', [['circle', []]]]]]]);
  assert.deepEqual(parser.parse(''), []);
});

test('UTF-16 offsets are exact after CRLF, Chinese and supplementary Unicode', () => {
  const source = '<?xml version="1.0"?>\r\n<svg>\r\n  <text>你好😀</text>\r\n  <g id="组"><rect id="r"/></g>\r\n</svg>';
  const root = new SvgOutlineParser().parse(source)[0]!;
  const group = root.children[1]!;
  const rect = group.children[0]!;
  assert.equal(group.start, source.indexOf('<g id='));
  assert.equal(group.end, source.indexOf('</g>') + 4);
  assert.equal(rect.selectionStart, source.indexOf('<rect') + 1);
  assert.equal(source.slice(rect.start, rect.end), '<rect id="r"/>');
  assert.equal(source.slice(rect.selectionStart, rect.selectionEnd), 'rect');
});

test('quoted >, comments, CDATA and processing instructions do not invent outline nodes', () => {
  const source = '<!-- <fake/> --><svg data-note="a > b"><g id="a&amp;b" data-x=\'>x\'><text><![CDATA[<fake/> <!DOCTYPE harmless>]]></text><?note <also-fake?> <!-- <hidden/> --></g></svg>';
  const root = new SvgOutlineParser().parse(source)[0]!;
  assert.deepEqual(names([root]), [['svg', [['g#a&b', [['text', []]]]]]]);
  assert.equal(source.slice(root.start, root.end), source.slice(source.indexOf('<svg')));
  assert.equal(root.children[0]!.selectionEnd - root.children[0]!.selectionStart, 1);
});

test('namespace prefixes and SVG tags beyond the CLI whitelist are preserved', () => {
  const source = '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:defs><s:linearGradient id="fade"><s:stop/></s:linearGradient></s:defs><s:path id="shape" d="M0 0"/></s:svg>';
  const root = new SvgOutlineParser().parse(source)[0]!;
  assert.deepEqual(names([root]), [['s:svg', [['s:defs', [['s:linearGradient#fade', [['s:stop', []]]]]], ['s:path#shape', []]]]]);
  assert.equal(source.slice(root.children[1]!.selectionStart, root.children[1]!.selectionEnd), 's:path');
});

test('numeric and predefined entities in id are decoded while source locations are untouched', () => {
  const source = '<svg><g id="A&#x1F600;&#38;&quot;"/><path id=""/></svg>';
  const root = new SvgOutlineParser().parse(source)[0]!;
  assert.equal(root.children[0]!.name, 'g#A😀&"');
  assert.equal(root.children[1]!.name, 'path');
  assert.equal(source.slice(root.children[0]!.start, root.children[0]!.end), '<g id="A&#x1F600;&#38;&quot;"/>');
});

test('unclosed, mismatched, malformed and multiple-root XML clears the outline', () => {
  const parser = new SvgOutlineParser();
  for (const source of [
    '<svg>', '<svg><g></svg>', '<svg><g/></sv', '<svg><rect id="r></rect></svg>',
    '<svg><rect id=r/></svg>', '<svg><rect id="a" id="b"/></svg>',
    '<svg/><svg/>', '<svg>plain & broken</svg>', '<svg><!----',
    '<svg><![CDATA[unfinished</svg>', '<svg><?note unfinished</svg>',
    '<svg><g/ > </svg>', '<svg><</svg>', '<svg><text>&unknown;</text></svg>',
  ]) assert.deepEqual(parser.parse(source), [], source);
});

test('DOCTYPE and ENTITY declarations are rejected; declarations written as comments are harmless', () => {
  const parser = new SvgOutlineParser();
  for (const source of [
    '<!DOCTYPE svg><svg/>',
    '<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg/>',
    '<!DOCTYPE svg [<!ENTITY x "value">]><svg><text>&x;</text></svg>',
    '<!ENTITY x "value"><svg/>',
  ]) assert.deepEqual(parser.parse(source), [], source);
  assert.equal(parser.parse('<!-- <!DOCTYPE svg> --><svg/>')[0]?.name, 'svg');
});

test('non-SVG XML roots and unrelated root namespaces do not populate SVG outline', () => {
  const parser = new SvgOutlineParser();
  for (const source of ['<html/>', '<g><svg/></g>', '<svg xmlns="urn:other"/>']) assert.deepEqual(parser.parse(source), []);
  assert.equal(parser.parse('<svg xmlns="http://www.w3.org/2000/svg"/>')[0]?.name, 'svg');
});

test('element ranges include complete non-self-closing elements and nested selections stay contained', () => {
  const source = '<svg>\n <g id="container">\n  <text id="t">Hello</text>\n </g>\n</svg>';
  const root = new SvgOutlineParser().parse(source)[0]!;
  const group = root.children[0]!;
  const text = group.children[0]!;
  assert.equal(source.slice(text.start, text.end), '<text id="t">Hello</text>');
  assert.equal(source.slice(group.start, group.end), '<g id="container">\n  <text id="t">Hello</text>\n </g>');
  for (const node of [root, group, text]) {
    assert.ok(node.start <= node.selectionStart && node.selectionStart < node.selectionEnd && node.selectionEnd <= node.end);
  }
  assert.ok(group.start < text.start && text.end < group.end);
});
