// Minimal hierarchical statechart (SCXML-flavoured): composite + parallel states, guards, entry/exit/transition
// actions, raised (internal) events. Mirrors the pattern used by the reference's flow engine (docs/12, docs/17).
//
// def = {
//   id: 'match', initial: 'preFight',
//   states: {
//     preFight: { on: { fightStart: 'fight' } },
//     fight: { initial: 'live', entry: [(ctx)=>…], exit: […],
//              states: { live: { on: { refStop: 'stopped', bell: { target: 'betweenRounds', guard: ctx=>…, actions:[…] } } }, … },
//              on: { ko: 'postFight' } },
//     …
//   }
// }
// Targets are dot-paths from the root ("fight.live"). A transition without `target` is internal (actions only).

export class Statechart {
  constructor(def, context = {}) {
    this.def = def;
    this.context = context;
    this.listeners = new Set();
    this.queue = [];
    this.active = new Set(); // set of active state paths
    this.started = false;
    this.nodes = new Map();
    this.#index('', { ...def, states: def.states }, null);
  }

  #index(path, node, parent) {
    node.__path = path;
    node.__parent = parent;
    this.nodes.set(path, node);
    for (const [name, child] of Object.entries(node.states ?? {})) {
      this.#index(path ? `${path}.${name}` : name, child, node);
    }
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.#enter(this.nodes.get(''), null, true);
    this.#drain();
    return this;
  }

  onTransition(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  raise(event, payload) { this.queue.push([event, payload]); }

  /** True if the path (or any descendant of it) is active. */
  matches(path) { return this.active.has(path); }
  /** Active leaf paths. */
  get value() {
    const leaves = [];
    for (const p of this.active) {
      const n = this.nodes.get(p);
      if (!n.states || Object.keys(n.states).length === 0) leaves.push(p);
    }
    return leaves.sort();
  }

  send(event, payload) {
    this.queue.push([event, payload]);
    this.#drain();
    return this;
  }

  #drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      let guard = 0;
      while (this.queue.length) {
        if (++guard > 1000) throw new Error('statechart: event storm');
        const [event, payload] = this.queue.shift();
        this.#handle(event, payload);
      }
    } finally {
      this.draining = false;
    }
  }

  #handle(event, payload) {
    // deepest active states first, bubbling up
    const leaves = this.value.map((p) => this.nodes.get(p));
    const handled = new Set();
    for (const leaf of leaves) {
      for (let n = leaf; n; n = n.__parent) {
        const t = this.#pick(n, event, payload);
        if (!t) continue;
        if (handled.has(t)) break;
        handled.add(t);
        this.#fire(n, t, event, payload);
        break;
      }
    }
  }

  #pick(node, event, payload) {
    let spec = node.on?.[event];
    if (spec === undefined) return null;
    const list = Array.isArray(spec) ? spec : [spec];
    for (const s of list) {
      const t = typeof s === 'string' ? { target: s } : s;
      if (!t.guard || t.guard(this.context, payload, this)) return t;
    }
    return null;
  }

  #fire(source, t, event, payload) {
    const from = this.value;
    if (t.target === undefined) {
      for (const a of t.actions ?? []) a(this.context, payload, this);
    } else {
      const target = this.nodes.get(t.target);
      if (!target) throw new Error(`statechart: unknown target "${t.target}"`);
      // exit up to (but not including) the least common ancestor of source scope and target
      const lca = this.#lca(source, target);
      this.#exitBelow(lca, payload);
      for (const a of t.actions ?? []) a(this.context, payload, this);
      this.#enterPath(lca, target, payload);
    }
    const to = this.value;
    for (const l of this.listeners) l({ event, payload, from, to });
  }

  #lca(a, b) {
    const anc = new Set();
    for (let n = a; n; n = n.__parent) anc.add(n);
    // an external transition from a to a descendant exits nothing above a; a self/ancestor target re-enters
    for (let n = b.__parent ?? b; n; n = n.__parent) if (anc.has(n)) return n;
    return this.nodes.get('');
  }

  #exitBelow(ancestor, payload) {
    const out = [...this.active].filter((p) => {
      const n = this.nodes.get(p);
      if (n === ancestor) return false;
      for (let q = n.__parent; q; q = q.__parent) if (q === ancestor) return true;
      return false;
    });
    out.sort((x, y) => y.length - x.length); // children first
    for (const p of out) {
      const n = this.nodes.get(p);
      for (const a of n.exit ?? []) a(this.context, payload, this);
      this.active.delete(p);
    }
  }

  #enterPath(ancestor, target, payload) {
    const chain = [];
    for (let n = target; n && n !== ancestor; n = n.__parent) chain.unshift(n);
    for (const n of chain) this.#enter(n, payload, n === target);
  }

  #enter(node, payload, descend) {
    if (!this.active.has(node.__path) || node.__path === '') {
      this.active.add(node.__path);
      for (const a of node.entry ?? []) a(this.context, payload, this);
    }
    if (!descend) return;
    const kids = Object.keys(node.states ?? {});
    if (kids.length === 0) return;
    if (node.type === 'parallel') {
      for (const k of kids) this.#enter(this.nodes.get(node.__path ? `${node.__path}.${k}` : k), payload, true);
    } else {
      const initial = node.initial ?? kids[0];
      this.#enter(this.nodes.get(node.__path ? `${node.__path}.${initial}` : initial), payload, true);
    }
  }
}
