import '@testing-library/jest-dom';
import { afterEach } from 'bun:test';
import { cleanup } from '@testing-library/react';
import { Window } from 'happy-dom';

if (typeof globalThis.document === 'undefined') {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
}

afterEach(cleanup);
