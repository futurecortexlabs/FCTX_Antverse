import { describe, expect, it } from 'vitest';
import { AgentFlag, AgentState, AgentStore, Caste, Task } from './store.ts';
import { SNAP_CASTE_QUEEN, SNAP_FLAG_ALIVE, SNAP_FLAG_UNDERGROUND, STATE_NAMES, TASK_NAMES } from '../../worker/protocol.ts';

describe('AgentStore', () => {
  it('spawns into consecutive slots and tracks counts', () => {
    const s = new AgentStore(8);
    expect([s.spawn(Caste.WORKER), s.spawn(Caste.WORKER), s.spawn(Caste.QUEEN)]).toEqual([0, 1, 2]);
    expect(s.alive).toBe(3);
    expect(s.highWater).toBe(3);
    expect(s.a.caste[2]).toBe(Caste.QUEEN);
    expect(s.a.rot[3]).toBe(1); // identity quaternion w
  });

  it('reuses freed slots LIFO and invalidates stale refs via generation', () => {
    const s = new AgentStore(8);
    const a = s.spawn(Caste.WORKER);
    const b = s.spawn(Caste.WORKER);
    const refA = s.ref(a);
    s.kill(a);
    expect(s.resolve(refA)).toBe(-1);
    expect(s.alive).toBe(1);
    const c = s.spawn(Caste.WORKER);
    expect(c).toBe(a);
    expect(s.resolve(refA)).toBe(-1);
    expect(s.resolve(s.ref(c))).toBe(c);
    expect(s.resolve(s.ref(b))).toBe(b);
  });

  it('throws when capacity is exhausted', () => {
    const s = new AgentStore(2);
    s.spawn(0); s.spawn(0);
    expect(() => s.spawn(0)).toThrow();
  });

  it('snapshot alive bit mirrors AgentFlag.ALIVE', () => {
    expect(SNAP_FLAG_ALIVE).toBe(AgentFlag.ALIVE);
    expect(SNAP_FLAG_UNDERGROUND).toBe(AgentFlag.UNDERGROUND);
    expect(SNAP_CASTE_QUEEN).toBe(Caste.QUEEN);
    // The observer's names follow the enums' values in order.
    expect(STATE_NAMES.length).toBe(Object.keys(AgentState).length);
    for (const v of Object.values(AgentState)) expect(STATE_NAMES[v]).toBeDefined();
    expect(STATE_NAMES[AgentState.NURSE]).toBe('nurse');
    expect(STATE_NAMES[AgentState.EXIT]).toBe('exit');
    expect(TASK_NAMES.length).toBe(Object.keys(Task).length);
    expect(TASK_NAMES[Task.FORAGE]).toBe('forage');
  });
});
