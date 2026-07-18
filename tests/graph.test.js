import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

let sqlDb;
const { initGraph, addEntity, addRelation, getEntity, searchEntities, getEntityRelations, extractEntities, ingestAndLink, getGraphStats, clearGraph } = await import('./graph.js');

describe('Graph Memory — initialization', () => {
  before(async () => {
    const SQL = await initSqlJs();
    sqlDb = new SQL.Database();
    await initGraph(sqlDb);
  });

  it('should create graph_entities table', () => {
    const rows = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='graph_entities'");
    assert.ok(rows.length > 0);
  });

  it('should create graph_relations table', () => {
    const rows = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='graph_relations'");
    assert.ok(rows.length > 0);
  });
});

describe('Graph Memory — entity management', () => {
  let entityId;

  it('should add an entity', () => {
    const result = addEntity('Jeumpa LLM', 'project', { version: '1.0.0' });
    assert.ok(result.id);
    assert.equal(result.existing, false);
    entityId = result.id;
  });

  it('should not duplicate existing entity', () => {
    const result = addEntity('Jeumpa LLM', 'project');
    assert.equal(result.existing, true);
  });

  it('should get entity by ID with relations', () => {
    const entity = getEntity(entityId);
    assert.ok(entity);
    assert.equal(entity.name, 'Jeumpa LLM');
    assert.equal(entity.type, 'project');
    assert.ok(Array.isArray(entity.relations));
  });

  it('should return null for unknown entity', () => {
    assert.equal(getEntity('unknown'), null);
  });

  it('should search entities by name', () => {
    const results = searchEntities('Jeumpa');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.name === 'Jeumpa LLM'));
  });

  it('should return empty search for no match', () => {
    const results = searchEntities('zzzzzzz');
    assert.equal(results.length, 0);
  });
});

describe('Graph Memory — relations', () => {
  let entityA, entityB;

  before(() => {
    entityA = addEntity('AI', 'concept');
    entityB = addEntity('Machine Learning', 'concept');
  });

  it('should add a relation between entities', () => {
    const result = addRelation(entityA.id, entityB.id, 'subsumes', 1.0, 'AI encompasses ML');
    assert.ok(!result.updated); // first time
  });

  it('should update weight on duplicate relation', () => {
    const result = addRelation(entityA.id, entityB.id, 'subsumes', 2.0, 'Updated context');
    assert.equal(result.updated, true);
  });

  it('should get relations for entity', () => {
    const relations = getEntityRelations(entityA.id);
    assert.ok(relations.length >= 1);
    assert.ok(relations.some(r => r.relation_type === 'subsumes'));
  });
});

describe('Graph Memory — entity extraction', () => {
  it('should extract entities from text', () => {
    const text = 'JavaScript and Python are popular. OpenAI GPT-4o uses deep learning.';
    const entities = extractEntities(text);
    assert.ok(entities.length >= 3);
    assert.ok(entities.some(e => e.name === 'JavaScript'));
    assert.ok(entities.some(e => e.name === 'Python'));
  });

  it('should extract and link entities', () => {
    const text = 'Docker and Kubernetes are container orchestration tools.';
    const result = ingestAndLink(text, 'test');
    assert.ok(result.count >= 2);
    assert.ok(result.entities.some(e => e.name === 'Docker'));
  });

  it('should handle empty text', () => {
    const entities = extractEntities('');
    assert.equal(entities.length, 0);
  });
});

describe('Graph Memory — stats and cleanup', () => {
  it('should return graph statistics', () => {
    const stats = getGraphStats();
    assert.ok(stats.entities > 0);
    assert.ok(stats.relations > 0);
    assert.ok(Array.isArray(stats.types));
  });

  it('should clear all graph data', () => {
    clearGraph();
    const stats = getGraphStats();
    assert.equal(stats.entities, 0);
    assert.equal(stats.relations, 0);
  });
});
