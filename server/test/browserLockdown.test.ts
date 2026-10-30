// Developer-tools guard of the production apps (panel comment, decision D-P7). It is a deterrent, not a security boundary (the data are protected on the server); what is
// checked here is which key combinations and menus it stops, that text fields keep their own menu, and that it is OFF unless a production build switches it on.
//   run:  cd server && npx tsx --test test/browserLockdown.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserLockdown, isDevToolsShortcut } from '../../packages/shared/src/utils/browserLockdown';

const key = (over: Record<string, unknown>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

describe('isDevToolsShortcut', () => {
  it('stops F12', () => {
    assert.equal(isDevToolsShortcut(key({ key: 'F12', code: 'F12' })), true);
  });
  it('stops Ctrl/Cmd + Shift + I, J, C and K (inspector, console, element picker, Firefox console)', () => {
    for (const letter of ['I', 'J', 'C', 'K']) {
      assert.equal(isDevToolsShortcut(key({ key: letter, code: `Key${letter}`, ctrlKey: true, shiftKey: true })), true, `ctrl+shift+${letter}`);
      assert.equal(isDevToolsShortcut(key({ key: letter, code: `Key${letter}`, metaKey: true, shiftKey: true })), true, `cmd+shift+${letter}`);
    }
  });
  it('stops Cmd + Option + I, J, C, U on a Mac, where Option changes the typed character', () => {
    for (const letter of ['I', 'J', 'C', 'U']) assert.equal(isDevToolsShortcut(key({ key: 'ˆ', code: `Key${letter}`, metaKey: true, altKey: true })), true, `cmd+opt+${letter}`);
  });
  it('stops view-source, Ctrl/Cmd + U', () => {
    assert.equal(isDevToolsShortcut(key({ key: 'u', code: 'KeyU', ctrlKey: true })), true);
    assert.equal(isDevToolsShortcut(key({ key: 'u', code: 'KeyU', metaKey: true })), true);
  });
  it('leaves everyday shortcuts alone (copy, paste, select all, find, reload, save, print, the letters themselves)', () => {
    for (const k of ['c', 'v', 'a', 'f', 'r', 's', 'p', 'x', 'z']) assert.equal(isDevToolsShortcut(key({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: true })), false, `ctrl+${k}`);
    for (const k of ['i', 'j', 'c', 'u']) assert.equal(isDevToolsShortcut(key({ key: k, code: `Key${k.toUpperCase()}` })), false, `plain ${k}`);
    assert.equal(isDevToolsShortcut(key({ key: 'F5', code: 'F5' })), false);
    assert.equal(isDevToolsShortcut(key({ key: 'I', code: 'KeyI', shiftKey: true })), false);      // typing a capital I
  });
});

function fakeDocument() {
  const listeners = new Map<string, Array<(e: Event) => void>>();
  return {
    addEventListener: (type: string, fn: (e: Event) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener: (type: string, fn: (e: Event) => void) => { listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)); },
    fire: (type: string, event: Record<string, unknown>) => {
      const e = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
      (listeners.get(type) ?? []).forEach((fn) => fn(e as unknown as Event));
      return e as { prevented: boolean; stopped: boolean };
    },
    count: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
  };
}

describe('installBrowserLockdown', () => {
  it('does nothing unless it is switched on (a development build keeps its tools)', () => {
    const doc = fakeDocument();
    const remove = installBrowserLockdown({ enabled: false, target: doc });
    assert.equal(doc.count(), 0);
    assert.equal(doc.fire('keydown', key({ key: 'F12', code: 'F12' })).prevented, false);
    remove();
  });

  it('when on: blocks the shortcuts and the right-click menu, and a blocked key goes no further', () => {
    const doc = fakeDocument();
    installBrowserLockdown({ enabled: true, target: doc });
    const f12 = doc.fire('keydown', key({ key: 'F12', code: 'F12' }));
    assert.equal(f12.prevented, true);
    assert.equal(f12.stopped, true);
    assert.equal(doc.fire('keydown', key({ key: 'c', code: 'KeyC', ctrlKey: true })).prevented, false);
    assert.equal(doc.fire('contextmenu', { target: { tagName: 'DIV' } }).prevented, true);
  });

  it('a text field keeps its own menu (paste, spell check), also a contenteditable one', () => {
    const doc = fakeDocument();
    installBrowserLockdown({ enabled: true, target: doc });
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(doc.fire('contextmenu', { target: { tagName } }).prevented, false, tagName);
    assert.equal(doc.fire('contextmenu', { target: { tagName: 'DIV', isContentEditable: true } }).prevented, false);
  });

  it('can be removed again, leaving nothing behind', () => {
    const doc = fakeDocument();
    const remove = installBrowserLockdown({ enabled: true, target: doc });
    assert.equal(doc.count(), 2);
    remove();
    assert.equal(doc.count(), 0);
    assert.equal(doc.fire('keydown', key({ key: 'F12', code: 'F12' })).prevented, false);
  });
});
