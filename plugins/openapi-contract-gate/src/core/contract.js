const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 60;
const MAX_NODES = 40000;
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

export function pathContract(platform, file) {
  const name = String(file || '').split(platform === 'win32' ? /[\\/]/ : /\//).pop();
  return { platform, name, accepted: /\.(json|ya?ml)$/i.test(name) };
}

function utf8Length(text) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8');
}

function auditDocument(root) {
  const stack = [[root, 0]];
  const seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (depth > MAX_DEPTH) throw Error('Document nesting exceeds limit');
    if (++nodes > MAX_NODES) throw Error('Document node count exceeds limit');
    for (const [key, next] of Object.entries(value)) {
      if (key === '$ref' && typeof next === 'string' && !next.startsWith('#/')) throw Error('Remote $ref is not allowed');
      stack.push([next, depth + 1]);
    }
  }
}

export function parseDocument(text) {
  const source = String(text);
  if (utf8Length(source) > MAX_BYTES) throw Error('Document exceeds 10 MiB limit');
  let document;
  try { document = JSON.parse(source); } catch (error) { throw Error(`Invalid contract: ${error.message}`); }
  if (!document || typeof document !== 'object' || !(document.openapi || document.swagger)) throw Error('Requires OpenAPI 3 or Swagger 2 root');
  auditDocument(document);
  return document;
}

function pointer(...parts) {
  const base = typeof parts[0] === 'string' && parts[0].startsWith('/') ? parts.shift().replace(/\/$/, '') : '';
  return `${base}/${parts.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}
function resolve(value, document) {
  let current = value;
  const visited = new Set();
  for (let depth = 0; current?.$ref; depth++) {
    const ref = current.$ref;
    if (depth >= MAX_DEPTH || visited.has(ref)) throw Error('Local $ref cycle exceeds limit');
    if (typeof ref !== 'string' || !ref.startsWith('#/')) throw Error('Only local $ref values are allowed');
    visited.add(ref);
    let target = document;
    for (const rawPart of ref.slice(2).split('/')) {
      const part = decodeURIComponent(rawPart).replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, part)) throw Error(`Invalid local $ref: ${ref}`);
      target = target[part];
    }
    current = target;
  }
  return current === undefined ? {} : current;
}
function schemaForParameter(parameter) {
  if (parameter?.schema) return parameter.schema;
  const contentSchema = Object.values(parameter?.content || {})[0]?.schema;
  if (contentSchema) return contentSchema;
  if (!parameter) return undefined;
  const { name, in: location, required, description, ...schema } = parameter;
  return Object.keys(schema).length ? schema : undefined;
}
function finding(level, kind, where, reason) { return { level, kind, pointer: where, reason }; }
function values(value) { return value === undefined ? null : new Set(Array.isArray(value) ? value : [value]); }
function missing(from, within) { return [...from].filter((item) => !within.has(item)); }
function additionalMode(schema) {
  const value = schema.additionalProperties;
  return value === undefined || value === true ? 'any' : value === false ? 'none' : 'schema';
}
function compareAdditionalProperties(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs) {
  const oldMode = additionalMode(oldValue), newMode = additionalMode(newValue);
  const requestBreak = oldMode === 'any' && newMode !== 'any' || oldMode === 'schema' && newMode === 'none';
  const responseBreak = oldMode === 'none' && newMode !== 'none' || oldMode === 'schema' && newMode === 'any';
  if (direction === 'request' && requestBreak || direction === 'response' && responseBreak) {
    out.push(finding('breaking', 'schema.additionalProperties', pointer(where, 'additionalProperties'), `${direction} additional properties compatibility narrowed`));
  }
  if (oldMode === 'schema' && newMode === 'schema') {
    compareSchema(oldValue.additionalProperties, newValue.additionalProperties, pointer(where, 'additionalProperties'), out, oldDoc, newDoc, direction, pairs);
  }
}
function changed(left, right) { return JSON.stringify(left) !== JSON.stringify(right); }
function breakingConstraint(out, where, name, direction) { out.push(finding('breaking', `schema.${name}`, pointer(where, name), `${direction} assertion compatibility changed`)); }
function compareAssertions(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs) {
  const request = direction === 'request';
  const tightenedMinimum = (name) => request ? newValue[name] !== undefined && (oldValue[name] === undefined || newValue[name] > oldValue[name]) : oldValue[name] !== undefined && (newValue[name] === undefined || newValue[name] < oldValue[name]);
  const tightenedMaximum = (name) => request ? newValue[name] !== undefined && (oldValue[name] === undefined || newValue[name] < oldValue[name]) : oldValue[name] !== undefined && (newValue[name] === undefined || newValue[name] > oldValue[name]);
  for (const name of ['minLength', 'minimum', 'exclusiveMinimum', 'minItems', 'minProperties']) if (tightenedMinimum(name)) breakingConstraint(out, where, name, direction);
  for (const name of ['maxLength', 'maximum', 'exclusiveMaximum', 'maxItems', 'maxProperties']) if (tightenedMaximum(name)) breakingConstraint(out, where, name, direction);
  if (request && oldValue.nullable && !newValue.nullable || !request && !oldValue.nullable && newValue.nullable) breakingConstraint(out, where, 'nullable', direction);
  if (request && newValue.const !== undefined && changed(oldValue.const, newValue.const) || !request && oldValue.const !== undefined && changed(oldValue.const, newValue.const)) breakingConstraint(out, where, 'const', direction);
  for (const name of ['pattern', 'format', 'multipleOf']) {
    const oldAssertion = oldValue[name], newAssertion = newValue[name];
    if (request && newAssertion !== undefined && changed(oldAssertion, newAssertion) || !request && oldAssertion !== undefined && changed(oldAssertion, newAssertion)) breakingConstraint(out, where, name, direction);
  }
  if (request && !oldValue.uniqueItems && newValue.uniqueItems || !request && oldValue.uniqueItems && !newValue.uniqueItems) breakingConstraint(out, where, 'uniqueItems', direction);
  if (Object.prototype.hasOwnProperty.call(oldValue, 'items') || Object.prototype.hasOwnProperty.call(newValue, 'items')) {
    if (!Object.prototype.hasOwnProperty.call(oldValue, 'items') || !Object.prototype.hasOwnProperty.call(newValue, 'items')) breakingConstraint(out, where, 'items', direction);
    else compareSchema(oldValue.items, newValue.items, pointer(where, 'items'), out, oldDoc, newDoc, direction, pairs);
  }
  for (const name of ['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'contains', 'prefixItems']) {
    if (changed(oldValue[name], newValue[name])) out.push(finding('breaking', 'schema.inconclusive', pointer(where, name), `${direction} ${name} changed and compatibility cannot be proven`));
  }
  const handled = new Set(['$ref', 'type', 'enum', 'nullable', 'const', 'minLength', 'maxLength', 'pattern', 'format', 'multipleOf', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'uniqueItems', 'items', 'minProperties', 'maxProperties', 'properties', 'required', 'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'contains', 'prefixItems']);
  const metadata = new Set(['title', 'description', 'default', 'example', 'examples', 'deprecated', 'externalDocs', '$id', '$schema']);
  for (const name of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
    if (!handled.has(name) && !metadata.has(name) && changed(oldValue[name], newValue[name])) out.push(finding('breaking', 'schema.inconclusive', pointer(where, name), `${direction} ${name} changed and compatibility cannot be proven`));
  }
}

function compareSchema(oldSchema, newSchema, where, out, oldDoc, newDoc, direction, pairs = new WeakMap()) {
  if (oldSchema === undefined || newSchema === undefined) return;
  const oldValue = resolve(oldSchema, oldDoc);
  const newValue = resolve(newSchema, newDoc);
  if (typeof oldValue === 'boolean' || typeof newValue === 'boolean') {
    if (oldValue !== newValue) out.push(finding('breaking', 'schema.boolean', where, `${direction} boolean schema compatibility changed`));
    return;
  }
  if (typeof oldValue === 'object' && typeof newValue === 'object') {
    let targets = pairs.get(oldValue);
    if (!targets) { targets = new WeakSet(); pairs.set(oldValue, targets); }
    if (targets.has(newValue)) return;
    targets.add(newValue);
  }
  const oldTypes = values(oldValue.type), newTypes = values(newValue.type);
  if ((direction === 'request' && !oldTypes && newTypes) || (direction === 'response' && oldTypes && !newTypes)) {
    out.push(finding('breaking', 'schema.type', where, `${direction} type compatibility narrowed`));
  } else if (oldTypes && newTypes) {
    const invalid = direction === 'request' ? missing(oldTypes, newTypes) : missing(newTypes, oldTypes);
    if (invalid.length) out.push(finding('breaking', 'schema.type', where, `${direction} type compatibility changed: ${invalid.join(', ')}`));
  }
  if ((direction === 'request' && !oldValue.enum && newValue.enum) || (direction === 'response' && oldValue.enum && !newValue.enum)) {
    out.push(finding('breaking', 'schema.enum', where, `${direction} enum compatibility narrowed`));
  } else if (oldValue.enum && newValue.enum) {
    const invalid = direction === 'request' ? missing(new Set(oldValue.enum), new Set(newValue.enum)) : missing(new Set(newValue.enum), new Set(oldValue.enum));
    if (invalid.length) out.push(finding('breaking', 'schema.enum', where, `${direction} enum compatibility changed: ${invalid.join(', ')}`));
  }
  const oldRequired = new Set(oldValue.required || []), newRequired = new Set(newValue.required || []);
  if (direction === 'request') for (const name of missing(newRequired, oldRequired)) out.push(finding('breaking', 'schema.required', pointer(where, 'required'), `Field ${name} became required`));
  if (direction === 'response') for (const name of missing(oldRequired, newRequired)) out.push(finding('breaking', 'schema.required', pointer(where, 'required'), `Response field ${name} is no longer required`));
  const oldProperties = oldValue.properties || {}, newProperties = newValue.properties || {};
  for (const [name, oldProperty] of Object.entries(oldProperties)) {
    if (!Object.prototype.hasOwnProperty.call(newProperties, name)) {
      if (direction === 'response') out.push(finding('breaking', 'schema.property', pointer(where, 'properties', name), 'Response property removed'));
      if (direction === 'request') out.push(finding('breaking', 'schema.property', pointer(where, 'properties', name), 'Accepted request property removed'));
      continue;
    }
    compareSchema(oldProperty, newProperties[name], pointer(where, 'properties', name), out, oldDoc, newDoc, direction, pairs);
  }
  compareAdditionalProperties(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs);
  compareAssertions(oldValue, newValue, where, out, oldDoc, newDoc, direction, pairs);
  if (direction === 'request') for (const name of Object.keys(newProperties)) if (!Object.prototype.hasOwnProperty.call(oldProperties, name) && !newRequired.has(name)) out.push(finding('non-breaking', 'schema.property', pointer(where, 'properties', name), 'Optional request property added'));
}

function parameters(operation, pathItem, document) {
  const merged = new Map();
  for (const parameter of [...(pathItem?.parameters || []), ...(operation.parameters || [])]) {
    const resolved = resolve(parameter, document);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }
  return [...merged.values()];
}
function effectiveSecurity(document, operation) {
  const value = Object.prototype.hasOwnProperty.call(operation, 'security') ? operation.security : document.security;
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((requirement) => Object.fromEntries(Object.keys(requirement).sort().map((key) => [key, [...(requirement[key] || [])].sort()])))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function sameSecurity(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function compareSecurity(oldDoc, newDoc, oldOperation, newOperation, where, out) {
  const oldSecurity = effectiveSecurity(oldDoc, oldOperation), newSecurity = effectiveSecurity(newDoc, newOperation);
  if (sameSecurity(oldSecurity, newSecurity)) return;
  if (newSecurity.length === 0) out.push(finding('info', 'security', where, 'Operation allows anonymous access'));
  else if (oldSecurity.length === 0) out.push(finding('breaking', 'security', where, 'Operation now requires security'));
  else out.push(finding('breaking', 'security', where, 'Effective security requirements changed'));
}
function compareRequestBody(oldBody, newBody, where, out, oldDoc, newDoc) {
  oldBody = oldBody && resolve(oldBody, oldDoc);
  newBody = newBody && resolve(newBody, newDoc);
  if (!oldBody && newBody?.required) { out.push(finding('breaking', 'requestBody.required', where, 'New required request body')); return; }
  if (oldBody && !newBody) { out.push(finding('breaking', 'requestBody.content', where, 'Request body support removed')); return; }
  if (!oldBody || !newBody) return;
  if (!oldBody.required && newBody.required) out.push(finding('breaking', 'requestBody.required', where, 'Request body became required'));
  for (const [type, media] of Object.entries(oldBody.content || {})) {
    if (!newBody.content?.[type]) out.push(finding('breaking', 'requestBody.content', pointer(where, 'content', type), `Accepted content type ${type} removed`));
    else compareSchema(media.schema, newBody.content[type].schema, pointer(where, 'content', type, 'schema'), out, oldDoc, newDoc, 'request');
  }
}
function compareResponse(oldResponse, newResponse, where, out, oldDoc, newDoc) {
  oldResponse = resolve(oldResponse, oldDoc);
  newResponse = resolve(newResponse, newDoc);
  const oldContent = oldResponse.content;
  const newContent = newResponse.content;
  if (!oldContent && !newContent) {
    compareSchema(oldResponse.schema, newResponse.schema, pointer(where, 'schema'), out, oldDoc, newDoc, 'response');
    return;
  }
  for (const [type, media] of Object.entries(oldContent || {})) {
    if (!newContent?.[type]) out.push(finding('breaking', 'response.content', pointer(where, 'content', type), `Response content type ${type} removed`));
    else compareSchema(media.schema, newContent[type].schema, pointer(where, 'content', type, 'schema'), out, oldDoc, newDoc, 'response');
  }
}

export function compareContracts(oldDoc, newDoc) {
  const out = [], oldPaths = oldDoc.paths || {}, newPaths = newDoc.paths || {};
  for (const [route, oldPath] of Object.entries(oldPaths)) {
    if (!newPaths[route]) { out.push(finding('breaking', 'endpoint', pointer('paths', route), 'Endpoint removed')); continue; }
    const oldPathItem = resolve(oldPath, oldDoc), newPathItem = resolve(newPaths[route], newDoc);
    for (const method of METHODS) {
      const oldOperation = oldPathItem[method], newOperation = newPathItem[method];
      if (!oldOperation) continue;
      const base = pointer('paths', route, method);
      if (!newOperation) { out.push(finding('breaking', 'method', base, 'Method removed')); continue; }
      const oldParameters = parameters(oldOperation, oldPathItem, oldDoc), newParameters = parameters(newOperation, newPathItem, newDoc);
      const nextByKey = new Map(newParameters.map((item) => [`${item.in}:${item.name}`, item]));
      const oldKeys = new Set(oldParameters.map((item) => `${item.in}:${item.name}`));
      for (const parameter of oldParameters) {
        const key = `${parameter.in}:${parameter.name}`, next = nextByKey.get(key), where = pointer(base, 'parameters', key);
        if (!next) out.push(finding('breaking', 'parameter', where, `Parameter ${key} removed`));
        else {
          if (!parameter.required && next.required) out.push(finding('breaking', 'parameter.required', where, `Parameter ${key} became required`));
          compareSchema(schemaForParameter(parameter), schemaForParameter(next), pointer(where, 'schema'), out, oldDoc, newDoc, 'request');
        }
      }
      for (const parameter of newParameters) {
        const key = `${parameter.in}:${parameter.name}`;
        if (!oldKeys.has(key)) out.push(finding(parameter.required ? 'breaking' : 'non-breaking', 'parameter', pointer(base, 'parameters', key), parameter.required ? `New required parameter ${key}` : `Optional parameter ${key} added`));
      }
      compareSecurity(oldDoc, newDoc, oldOperation, newOperation, base, out);
      compareRequestBody(oldOperation.requestBody, newOperation.requestBody, pointer(base, 'requestBody'), out, oldDoc, newDoc);
      for (const [status, oldResponse] of Object.entries(oldOperation.responses || {})) {
        const next = newOperation.responses?.[status];
        if (!next) out.push(finding('breaking', 'response', pointer(base, 'responses', status), `Response ${status} removed`));
        else compareResponse(oldResponse, next, pointer(base, 'responses', status), out, oldDoc, newDoc);
      }
    }
    for (const method of METHODS) {
      if (!oldPathItem[method] && newPathItem[method]) {
        out.push(finding('non-breaking', 'method', pointer('paths', route, method), `Method ${method.toUpperCase()} added`));
      }
    }
  }
  for (const [route, pathItem] of Object.entries(newPaths)) if (!oldPaths[route]) out.push(finding('non-breaking', 'endpoint', pointer('paths', route), `Endpoint added (${Object.keys(pathItem).filter((key) => METHODS.includes(key)).join(', ')})`));
  return out;
}

function escapeMarkdown(value) { return String(value).replace(/[\\`*_{}\[\]<>]/g, '\\$&').replace(/\r?\n/g, ' '); }
export function reportMarkdown(findings) {
  const groups = ['breaking', 'non-breaking', 'info'];
  return ['# OpenAPI Contract Gate', '', ...groups.flatMap((group) => {
    const items = findings.filter((item) => item.level === group).map((item) => `- **${escapeMarkdown(item.kind)}** at \`${escapeMarkdown(item.pointer)}\`: ${escapeMarkdown(item.reason)}`);
    return [`## ${group}`, ...(items.length ? items : ['- None'])];
  })].join('\n');
}
