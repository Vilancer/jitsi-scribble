/**
 * querySelector / querySelectorAll polyfill for @xmldom/xmldom on React Native.
 *
 * Modern lib-jitsi-meet parses every inbound XMPP stanza with CSS selectors via its
 * `XMLUtils` helper (`findFirst`/`findAll`/`exists` → `element.querySelector(All)`), plus
 * `getChildren` → `element.children`. @xmldom/xmldom (our DOM polyfill for strophe) ships
 * none of these, so on RN the conference-IQ parse throws ("element.querySelector is not a
 * function") and the client connects but never joins ("no focusJid").
 *
 * This installs a minimal, correct CSS engine covering exactly the selector grammar
 * lib-jitsi-meet uses (verified by grepping every selector literal in the dist):
 *   - combinators: child `>` and descendant (whitespace)
 *   - `:scope` (leading; anchors to the element the method was called on)
 *   - type / universal `*` / implicit universal
 *   - attribute selectors: `[a]`, `[a="v"]`, `[a*="v"]`, and the namespace-wildcard
 *     form `[*|xmlns="v"]` (jitsi's way of matching by declared namespace)
 *   - comma selector lists
 * Matching is right-to-left per candidate in document order, so querySelector returns the
 * first match exactly like a browser. Everything funnels through XMLUtils, so this covers
 * all 17 call sites.
 */

// Split `s` on top-level occurrences of `sep` (ignoring anything inside `[...]`).
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth === 0 && ch === sep) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

function parseAttr(inner) {
  let s = inner.trim();
  if (s.startsWith('*|')) s = s.slice(2); // namespace wildcard → match by local name
  // Value may be double-quoted, single-quoted (lib-jitsi-meet's SDP.js template
  // literals use single quotes throughout), or unquoted.
  const m = s.match(/^([^*=\]]+?)(\*?=)(?:"([^"]*)"|'([^']*)'|([^"'\]]*))$/);
  if (m) {
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
    return { name: m[1].trim(), op: m[2], value };
  }
  return { name: s, op: null, value: null }; // [attr] presence
}

function parseCompound(str) {
  const s = str.trim();
  if (s === ':scope') return { scope: true, type: null, attrs: [] };
  let type = null;
  const attrs = [];
  let i = 0;
  let t = '';
  while (i < s.length && s[i] !== '[') {
    t += s[i];
    i++;
  }
  t = t.trim();
  if (t && t !== '*') type = t;
  while (i < s.length) {
    if (s[i] === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) break;
      attrs.push(parseAttr(s.slice(i + 1, end)));
      i = end + 1;
    } else {
      i++;
    }
  }
  return { scope: false, type, attrs };
}

function parseComplex(selRaw) {
  let sel = selRaw.trim();
  if (sel.startsWith('>')) sel = ':scope' + sel; // leading child combinator → relative to scope
  const compounds = [];
  const combs = [];
  let i = 0;
  let depth = 0;
  let buf = '';
  let pending = null;
  const flush = () => {
    const s = buf.trim();
    buf = '';
    if (s === '') return;
    if (compounds.length > 0) combs.push(pending || ' ');
    compounds.push(parseCompound(s));
    pending = null;
  };
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth === 0 && ch === '>') {
      flush();
      pending = '>';
      i++;
      while (i < sel.length && /\s/.test(sel[i])) i++;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      flush();
      while (i < sel.length && /\s/.test(sel[i])) i++;
      if (i < sel.length && sel[i] !== '>') pending = ' ';
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return { compounds, combs };
}

const cache = new Map();
function parseSelector(selector) {
  let cached = cache.get(selector);
  if (!cached) {
    cached = splitTopLevel(selector, ',').map((s) => parseComplex(s));
    cache.set(selector, cached);
  }
  return cached;
}

function matchCompound(node, comp, scopeNode) {
  if (comp.scope) return node === scopeNode;
  if (!node || node.nodeType !== 1) return false;
  if (comp.type) {
    const ln = node.localName || node.tagName;
    if (ln !== comp.type) return false;
  }
  for (const a of comp.attrs) {
    let val;
    if (a.name === 'xmlns') {
      val = node.getAttribute('xmlns');
      if (val == null || val === '') val = node.namespaceURI;
    } else {
      val = node.getAttribute(a.name);
    }
    if (a.op === null) {
      if (val == null) return false;
    } else if (a.op === '=') {
      if (val !== a.value) return false;
    } else if (a.op === '*=') {
      if (val == null || val.indexOf(a.value) < 0) return false;
    }
  }
  return true;
}

// Does `node` match the complex selector, anchored within `scopeNode`'s subtree?
function matchesComplex(node, complex, scopeNode) {
  const { compounds, combs } = complex;
  let idx = compounds.length - 1;
  if (!matchCompound(node, compounds[idx], scopeNode)) return false;
  let cur = node;
  idx--;
  while (idx >= 0) {
    const comb = combs[idx]; // combinator between compounds[idx] and compounds[idx+1]
    const comp = compounds[idx];
    if (comb === '>') {
      cur = cur.parentNode;
      if (!cur || !matchCompound(cur, comp, scopeNode)) return false;
    } else {
      // descendant: walk ancestors up to (and including) scopeNode
      cur = cur.parentNode;
      let found = false;
      while (cur) {
        if (matchCompound(cur, comp, scopeNode)) {
          found = true;
          break;
        }
        if (cur === scopeNode) break;
        cur = cur.parentNode;
      }
      if (!found) return false;
    }
    idx--;
  }
  return true;
}

function collectDescendants(node, out) {
  const kids = node.childNodes;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.nodeType === 1) {
      out.push(c);
      collectDescendants(c, out);
    }
  }
}

function querySelectorAllImpl(scopeNode, selector) {
  const complexes = parseSelector(selector);
  const candidates = [];
  collectDescendants(scopeNode, candidates);
  const out = [];
  for (const cand of candidates) {
    for (const complex of complexes) {
      if (matchesComplex(cand, complex, scopeNode)) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}

function querySelectorImpl(scopeNode, selector) {
  const complexes = parseSelector(selector);
  const candidates = [];
  collectDescendants(scopeNode, candidates);
  for (const cand of candidates) {
    for (const complex of complexes) {
      if (matchesComplex(cand, complex, scopeNode)) return cand;
    }
  }
  return null;
}

function elementChildren(node) {
  const out = [];
  const kids = node.childNodes;
  if (kids) {
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1) out.push(kids[i]);
    }
  }
  return out;
}

/**
 * Patch @xmldom/xmldom's Element and Document prototypes in place. Idempotent.
 * Derives the prototypes from a parsed sample (xmldom doesn't export the classes).
 */
function installXmlQuerySelector() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DOMParser } = require('@xmldom/xmldom');
  const sample = new DOMParser().parseFromString('<r><c/></r>', 'text/xml');
  const elementProto = Object.getPrototypeOf(sample.documentElement);
  const documentProto = Object.getPrototypeOf(sample);

  for (const proto of [elementProto, documentProto]) {
    if (typeof proto.querySelector !== 'function') {
      proto.querySelector = function (selector) {
        return querySelectorImpl(this, selector);
      };
    }
    if (typeof proto.querySelectorAll !== 'function') {
      proto.querySelectorAll = function (selector) {
        return querySelectorAllImpl(this, selector);
      };
    }
    if (!Object.getOwnPropertyDescriptor(proto, 'children')) {
      Object.defineProperty(proto, 'children', {
        configurable: true,
        get() {
          return elementChildren(this);
        },
      });
    }
  }

  // ChildNode / ParentNode mutation methods that @xmldom/xmldom omits but modern
  // lib-jitsi-meet uses when handling stanzas: ChatRoom strips the muc#user <x> with
  // `xEl.remove()` (its absence aborts presence processing → "session-initiate from
  // non-focus"), and SDP→Jingle conversion builds stanzas with `el.append(childEl)`.
  const asNode = (self, x) =>
    typeof x === 'string' ? self.ownerDocument.createTextNode(x) : x;
  const childNodeMethods = {
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    append(...nodes) {
      for (const n of nodes) this.appendChild(asNode(this, n));
    },
    prepend(...nodes) {
      const first = this.firstChild;
      for (const n of nodes) this.insertBefore(asNode(this, n), first);
    },
    before(...nodes) {
      const p = this.parentNode;
      if (!p) return;
      for (const n of nodes) p.insertBefore(asNode(this, n), this);
    },
    after(...nodes) {
      const p = this.parentNode;
      if (!p) return;
      const ref = this.nextSibling;
      for (const n of nodes) p.insertBefore(asNode(this, n), ref);
    },
    replaceWith(...nodes) {
      const p = this.parentNode;
      if (!p) return;
      for (const n of nodes) p.insertBefore(asNode(this, n), this);
      p.removeChild(this);
    },
  };
  for (const [name, fn] of Object.entries(childNodeMethods)) {
    if (typeof elementProto[name] !== 'function') elementProto[name] = fn;
  }
}

module.exports = {
  installXmlQuerySelector,
  // exported for unit testing in Node
  __internals: { parseComplex, matchesComplex, querySelectorImpl, querySelectorAllImpl },
};
