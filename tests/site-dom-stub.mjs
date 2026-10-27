/**
 * Minimal DOM stub for testing the site's render helpers without a browser or
 * any npm dependency. It deliberately throws when innerHTML is used, so the
 * safe-text tests fail if rendering ever switches to HTML string injection.
 */

class StubClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    for (const name of names) this.element._classes.add(name);
  }

  remove(...names) {
    for (const name of names) this.element._classes.delete(name);
  }

  contains(name) {
    return this.element._classes.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }
}

class StubStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
    this[name] = String(value);
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? '';
  }
}

export class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = new StubStyle();
    this._classes = new Set();
    this._textContent = '';
    this.classList = new StubClassList(this);
    this.hidden = false;
    this.disabled = false;
  }

  set className(value) {
    this._classes = new Set(
      String(value ?? '')
        .split(/\s+/)
        .filter(Boolean),
    );
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._textContent;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof StubElement)) {
        throw new Error(`append() only accepts StubElement instances, received ${typeof node}`);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  toggleAttribute(name, force) {
    const shouldAdd = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (shouldAdd) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return shouldAdd;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener() {
    /* rendering tests do not exercise interaction */
  }

  querySelectorAll() {
    return [];
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  get innerHTML() {
    throw new Error('innerHTML must not be read: render with createElement and textContent');
  }

  set innerHTML(_value) {
    throw new Error('innerHTML must not be assigned: render with createElement and textContent');
  }
}

function matches(node, selector) {
  if (!node || typeof selector !== 'string') return false;
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

export function createDocument() {
  const doc = {
    createElement(tagName) {
      return new StubElement(tagName);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };
  return doc;
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function findAll(node, predicate) {
  const found = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate);
  });
  return found;
}

export function findByClass(node, className) {
  return findAll(node, (candidate) => candidate.classList?.contains(className) ?? false);
}

export function textOf(node) {
  return foundText(node);
}

function foundText(node) {
  return node.textContent;
}
