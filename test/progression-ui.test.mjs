import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { progressionForXp } from '../src/progression.mjs';

const source = await readFile(new URL('../dist/progression-ui.js', import.meta.url), 'utf8');
function fixture() {
  const nodes = new Map(), timers = new Map();
  const createNode = () => ({ hidden: true, innerHTML: '', textContent: '', attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }, remove() { nodes.delete(this.id); } });
  for (const id of ['sidebar-progression', 'xp-announcement']) nodes.set(id, createNode());
  let timerId = 0;
  const body = { append(node) { nodes.set(node.id, node); } };
  const context = vm.createContext({ document: { getElementById: id => nodes.get(id), body,
    createElement: createNode, querySelector: () => null }, t: en => en, number: String,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(source, context);
  return { context, nodes, timers,
    update(xp, id = 'player', reset = false) { context.user = id ? { id, progression: progressionForXp(xp) } : null;
      vm.runInContext(`updatePersistentProgression(user, {reset:${reset}})`, context); } };
}

test('persistent XP displays current level and level-relative progress, translates and handles the level cap', () => {
  const f = fixture(); f.update(150);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /Level 2/);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /50 \/ 300 XP/);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /150 XP/);
  assert.equal(f.nodes.get('sidebar-progression').hidden, false);
  assert.equal(f.nodes.has('xp-feedback'), false, 'Signing in must not celebrate historical XP');
  f.context.t = (_, de) => de;
  vm.runInContext('renderPersistentProgression(user)', f.context);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /250 XP bis Level 3/);
  f.update(36100);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /Höchstes Level/);
  assert.match(f.nodes.get('sidebar-progression').innerHTML, /aria-valuenow="100"/);
  assert.doesNotMatch(f.nodes.get('sidebar-progression').innerHTML, /null|NaN|Level 21/);
});

test('server XP gains animate once, accumulate quick awards and announce level changes without replaying stale responses', () => {
  const f = fixture(); f.update(0); f.update(150);
  assert.equal(f.nodes.get('xp-feedback').textContent, '+150 XP · Level up! Level 2');
  assert.equal(f.nodes.get('xp-announcement').textContent, '+150 XP · Level up! Level 2');
  f.update(150); f.update(120); f.update(150);
  assert.equal(f.nodes.get('xp-feedback').textContent, '+150 XP · Level up! Level 2');
  f.update(170);
  assert.equal(f.nodes.get('xp-feedback').textContent, '+170 XP · Level up! Level 2');
  for (const callback of f.timers.values()) callback();
  assert.equal(f.nodes.has('xp-feedback'), false);
  f.update(180);
  assert.equal(f.nodes.get('xp-feedback').textContent, '+10 XP');
});

test('case opening with unchanged XP never celebrates; logout and account changes clear feedback, reset allows new gains', () => {
  const f = fixture(); f.update(150); f.update(150);
  assert.equal(f.nodes.has('xp-feedback'), false);
  f.update(170); f.update(0, null);
  assert.equal(f.nodes.has('xp-feedback'), false);
  assert.equal(f.nodes.get('sidebar-progression').hidden, true);
  f.update(500, 'other');
  assert.equal(f.nodes.has('xp-feedback'), false);
  f.update(0, 'other', true); f.update(150, 'other');
  assert.equal(f.nodes.get('xp-feedback').textContent, '+150 XP · Level up! Level 2');
});
