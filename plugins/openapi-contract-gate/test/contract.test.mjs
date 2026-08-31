import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compareContracts, parseDocument, pathContract, reportMarkdown } from '../src/core/contract.js';

const require = createRequire(import.meta.url);
const preload = require('../src/preload/index.cjs');
const doc = (operation, extra = {}) => ({ openapi: '3.1.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: operation } }, ...extra });
const operation = (overrides = {}) => ({ responses: { 200: { content: { 'application/json': { schema: { type: 'string', enum: ['ok'] } } } } }, ...overrides });
const has = (findings, kind) => findings.some((item) => item.kind === kind && item.level === 'breaking');

test('request and response variance has opposite enum/type directions', () => {
  const before = doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: ['string', 'null'], enum: ['a', 'b'] } }], requestBody: { content: { 'application/json': { schema: { type: 'string', enum: ['a', 'b'] } } } } }));
  const after = doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'string', enum: ['a'] } }], requestBody: { content: { 'application/json': { schema: { type: 'string', enum: ['a'] } } } }, responses: { 200: { content: { 'application/json': { schema: { type: ['string', 'null'], enum: ['ok', 'unknown'] } } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'schema.type'));
  assert.ok(has(findings, 'schema.enum'));
});

test('query header path and cookie schemas are compared', () => {
  const before = doc(operation({ parameters: ['query', 'header', 'path', 'cookie'].map((location) => ({ name: location === 'path' ? 'id' : location, in: location, required: location === 'path', schema: { type: 'string', enum: ['a', 'b'] } })) }));
  const after = doc(operation({ parameters: ['query', 'header', 'path', 'cookie'].map((location) => ({ name: location === 'path' ? 'id' : location, in: location, required: location === 'path', schema: { type: 'string', enum: ['a'] } })) }));
  assert.ok(compareContracts(before, after).filter((item) => item.kind === 'schema.enum').length >= 4);
});

test('Swagger 2 non-body parameter type and enum are compared directly', () => {
  const before = { swagger: '2.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], get: { parameters: [{ name: 'q', in: 'query', type: 'string', enum: ['a', 'b'] }], responses: { 200: { schema: { type: 'string' } } } } } } };
  const after = { swagger: '2.0', paths: { '/pets/{id}': { parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], get: { parameters: [{ name: 'q', in: 'query', type: 'string', enum: ['a'] }], responses: { 200: { schema: { type: 'string' } } } } } } };
  assert.ok(has(compareContracts(before, after), 'schema.enum'));
});

test('request body required and content removal are breaking', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object' } }, 'application/xml': { schema: { type: 'object' } } } } }));
  const after = doc(operation({ requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'requestBody.required'));
  assert.ok(has(findings, 'requestBody.content'));
  assert.ok(has(compareContracts(before, doc(operation())), 'requestBody.content'));
});

test('response compares matching media types and required output guarantees', () => {
  const before = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', enum: ['a'] } } } }, 'application/xml': { schema: { type: 'string' } } } } } }));
  const after = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { properties: { id: { enum: ['a', 'b'] } } } } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'response.content'));
  assert.ok(has(findings, 'schema.required'));
  assert.ok(has(findings, 'schema.type'));
  assert.ok(has(findings, 'schema.enum'));
});

test('unconstrained schemas becoming constrained are request breaks', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { legacy: {} }, additionalProperties: false } } } } }));
  const after = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { added: { type: 'string' } }, additionalProperties: false } } } } }));
  const findings = compareContracts(before, after);
  assert.ok(has(findings, 'schema.property'));
  assert.equal(has(findings, 'schema.type'), false);
  assert.equal(has(findings, 'schema.enum'), false);
  const constrained = doc(operation({ requestBody: { content: { 'application/json': { schema: { enum: ['a'] } } } } }));
  const loose = doc(operation({ requestBody: { content: { 'application/json': { schema: {} } } } }));
  assert.equal(has(compareContracts(constrained, loose), 'schema.enum'), false);
  assert.ok(has(compareContracts(loose, constrained), 'schema.enum'));
  const typed = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'string' } } } } }));
  assert.ok(has(compareContracts(loose, typed), 'schema.type'));
});

test('additionalProperties uses conservative request and response variance', () => {
  const requestBefore = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } }));
  const requestAfter = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } } }));
  assert.ok(has(compareContracts(requestBefore, requestAfter), 'schema.additionalProperties'));
  const responseBefore = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } } } }));
  const responseAfter = doc(operation({ responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } } }));
  assert.ok(has(compareContracts(responseBefore, responseAfter), 'schema.additionalProperties'));
  const schemaBefore = doc(operation({
    requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: { type: 'string' } } } } }
  }));
  const schemaAfter = doc(operation({
    requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: { type: 'number' } } } } }
  }));
  assert.ok(has(compareContracts(schemaBefore, schemaAfter), 'schema.type'));
});

test('common assertion tightening is checked in both variance directions', () => {
  const request = (schema) => doc(operation({ requestBody: { content: { 'application/json': { schema } } } }));
  assert.ok(has(compareContracts(request({ type: 'string', maxLength: 12 }), request({ type: 'string', maxLength: 4 })), 'schema.maxLength'));
  assert.ok(has(compareContracts(request({ type: 'string' }), request({ type: 'string', pattern: '^[A-Z]+$' })), 'schema.pattern'));
  assert.ok(has(compareContracts(request({ type: 'number', minimum: 1, maximum: 10 }), request({ type: 'number', minimum: 2, maximum: 9 })), 'schema.minimum'));
  assert.ok(has(compareContracts(request({ type: 'array', items: { type: 'string' } }), request({ type: 'array', items: { type: 'number' }, uniqueItems: true })), 'schema.type'));
  assert.ok(has(compareContracts(request({ nullable: true }), request({ nullable: false, const: 'x' })), 'schema.nullable'));
  const response = (schema) => doc(operation({ responses: { 200: { content: { 'application/json': { schema } } } } }));
  assert.ok(has(compareContracts(response({ type: 'string', maxLength: 4, pattern: '^[A-Z]+$' }), response({ type: 'string', maxLength: 12 })), 'schema.maxLength'));
  assert.ok(has(compareContracts(response({ type: 'array', uniqueItems: true, items: { type: 'string' } }), response({ type: 'array', uniqueItems: false, items: { type: 'string' } })), 'schema.uniqueItems'));
  assert.ok(compareContracts(request({ oneOf: [{ type: 'string' }] }), request({ oneOf: [{ type: 'number' }] })).some((item) => item.kind === 'schema.inconclusive'));
});

test('boolean schemas, const changes, hostile properties, Swagger keywords, and unknown assertions fail closed', () => {
  const request = (schema) => doc(operation({ requestBody: { content: { 'application/json': { schema } } } }));
  assert.ok(has(compareContracts(request(true), request(false)), 'schema.boolean'));
  assert.ok(has(compareContracts(request({ type: 'array', items: true }), request({ type: 'array', items: false })), 'schema.boolean'));
  assert.ok(has(compareContracts(request({ const: 'A' }), request({ const: 'B' })), 'schema.const'));
  const hostileProperties = Object.create(null); Object.defineProperty(hostileProperties, '__proto__', { value: { type: 'string' }, enumerable: true });
  assert.ok(has(compareContracts(request({ type: 'object', properties: hostileProperties }), request({ type: 'object', properties: {} })), 'schema.property'));
  const swaggerBefore = { swagger: '2.0', paths: { '/x': { get: { parameters: [{ name: 'q', in: 'query', type: 'string', maxLength: 12 }], responses: { 200: { schema: { type: 'string' } } } } } } };
  const swaggerAfter = structuredClone(swaggerBefore); swaggerAfter.paths['/x'].get.parameters[0].maxLength = 4;
  assert.ok(has(compareContracts(swaggerBefore, swaggerAfter), 'schema.maxLength'));
  assert.ok(compareContracts(request({ minContains: 1 }), request({ minContains: 2 })).some((item) => item.kind === 'schema.inconclusive'));
});

test('local refs decode JSON Pointer and resolve all comparison entry points', () => {
  const base = {
    openapi: '3.1.0',
    components: {
      schemas: { 'A/B': { type: 'string' }, 'T~N': { type: 'number' } },
      parameters: { query: { name: 'q', in: 'query', schema: { $ref: '#/components/schemas/A~1B' } } },
      requestBodies: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } } } },
      responses: { ok: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A~1B' } } } } }
    },
    paths: { '/x': { get: { parameters: [{ $ref: '#/components/parameters/query' }], requestBody: { $ref: '#/components/requestBodies/body' }, responses: { 200: { $ref: '#/components/responses/ok' } } } } }
  };
  const changed = structuredClone(base);
  changed.components.schemas['A/B'] = { $ref: '#/components/schemas/T~0N' };
  const findings = compareContracts(base, changed);
  assert.ok(has(findings, 'schema.type'));
  const pathRef = structuredClone(base);
  pathRef.components.pathItems = { x: pathRef.paths['/x'] };
  pathRef.paths['/x'] = { $ref: '#/components/pathItems/x' };
  assert.doesNotThrow(() => compareContracts(pathRef, pathRef));
  const cycle = structuredClone(base);
  cycle.components.schemas.loop = { $ref: '#/components/schemas/loop' };
  cycle.components.parameters.query.schema = { $ref: '#/components/schemas/loop' };
  assert.throws(() => compareContracts(cycle, base), /cycle/);
  const bad = structuredClone(base);
  bad.components.parameters.query = { $ref: '#/components/parameters/missing' };
  assert.throws(() => compareContracts(bad, base), /Invalid local \$ref/);
});

test('effective global and operation security respects explicit empty arrays', () => {
  const before = doc(operation(), { security: [{ bearer: [] }] });
  const anonymous = doc(operation({ security: [] }), { security: [{ bearer: [] }] });
  const required = doc(operation(), {});
  assert.ok(compareContracts(before, anonymous).some((item) => item.level === 'info' && item.kind === 'security'));
  assert.ok(has(compareContracts(anonymous, before), 'security'));
  assert.ok(has(compareContracts(required, before), 'security'));
  assert.equal(compareContracts(required, doc(operation({ security: [] }))).some((item) => item.kind === 'security'), false);
  const reordered = doc(operation(), { security: [{ oauth: ['write', 'read'], bearer: [] }, { api: [] }] });
  assert.equal(compareContracts(doc(operation(), { security: [{ api: [] }, { bearer: [], oauth: ['read', 'write'] }] }), reordered).some((item) => item.kind === 'security'), false);
});

test('reports non-breaking methods, optional parameters and properties', () => {
  const before = doc(operation({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } }));
  const after = {
    openapi: '3.1.0',
    paths: {
      '/pets/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: operation({ parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } } }),
        post: operation()
      }
    }
  };
  const levels = compareContracts(before, after).filter((item) => item.level === 'non-breaking');
  assert.ok(levels.some((item) => item.reason.includes('Optional parameter')));
  assert.ok(levels.some((item) => item.reason.includes('Optional request property')));
  assert.ok(levels.some((item) => item.kind === 'method'));
});

test('YAML is parsed only in preload and aliases/tags are rejected there', () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testGrant([fixture]);
  assert.equal(JSON.parse(preload.readGranted()[0]).paths['/pets'].get.parameters[0].name, 'limit');
  for (const name of ['alias.yaml', 'tag.yaml']) {
    preload.__testGrant([fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))]);
    assert.throws(() => preload.readGranted(), /YAML anchors, aliases and explicit tags/);
  }
  assert.throws(() => parseDocument('openapi: 3.1.0\npaths: {}'));
});

test('markdown escapes untrusted fields and pointers are escaped', () => {
  const markdown = reportMarkdown([{ level: 'breaking', kind: '*kind*', pointer: '/a/~b', reason: '<bad>\ntext' }]);
  assert.match(markdown, /\\\*kind\\\*/);
  assert.match(markdown, /\\<bad\\> text/);
  assert.ok(compareContracts({ openapi: '3.0.0', paths: { '/a/b': { get: operation() } } }, { openapi: '3.0.0', paths: {} }).some((item) => item.pointer === '/paths/~1a~1b'));
  const nested = compareContracts(doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] })), doc(operation({ parameters: [{ name: 'q', in: 'query', schema: { type: 'number' } }] })));
  assert.ok(nested.some((item) => item.pointer === '/paths/~1pets~1{id}/get/parameters/query:q/schema'));
});

test('preload clears canceled, expired and failed multi-file selections', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/openapi.yaml', import.meta.url));
  preload.__testGrant([fixture]);
  const consumed = preload.__testGrants()[0];
  preload.readGranted();
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(consumed.fd), { code: 'EBADF' });
  preload.__testGrant([fixture]);
  await preload.bridge({ showOpenDialog: async () => ({ filePaths: [] }) }).choose();
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => preload.__testGrant([fixture, '/does-not-exist.yaml']));
  assert.equal(preload.__testGrants().length, 0);
  preload.__testGrant([fixture]);
  preload.__testGrants()[0].until = 0;
  assert.throws(() => preload.readGranted(), /expired/);
  assert.equal(preload.__testGrants().length, 0);
});

test('renderer uses DOM text and path contract is cross-platform', () => {
  assert.equal(fs.readFileSync(new URL('../src/main/app.js', import.meta.url), 'utf8').includes('innerHTML'), false);
  const style = fs.readFileSync(new URL('../src/main/style.css', import.meta.url), 'utf8');
  assert.match(style, /\.entry code\{[^}]*overflow-wrap:anywhere/);
  assert.match(style, /textarea\{[^}]*min-width:0/);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/core/contract.js', import.meta.url), 'utf8'), /^\s*import\s/m);
  for (const platform of ['win32', 'darwin', 'linux']) assert.ok(pathContract(platform, platform === 'win32' ? 'C:\\x\\a.yaml' : '/x/a.yaml').accepted);
});
