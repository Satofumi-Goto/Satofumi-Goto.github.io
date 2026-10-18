// These isolated component tests exercise the archived source, not the full
// Base44 app or its absent calculation engines. No deployed app is modified.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
const ORIGIN = 'https://federation.base44.app';
const CHANNEL = 'federation.mission.business.v1';

async function compile(source, globals = {}) {
  const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
  const context = { React, require, module: { exports: {} }, exports: {}, ...globals };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context);
  return context.module.exports;
}

const workspaceSource = app.slice(app.indexOf('const MISSION_DEFAULTS='), app.indexOf('const AuthenticatedApp'));

function createWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(data, source, origin = ORIGIN) { listeners.get('message')?.({ data, source, origin }); },
    get listenerCount() { return listeners.size; },
  };
}

test('both archived JSX files transpile', async () => {
  for (const [name, source] of [['App.jsx', app], ['Layout.jsx', layout]]) {
    const output = await transform(source, { loader: 'jsx', sourcefile: name });
    assert.ok(output.code.length > 0);
  }
});

for (const mode of ['city', 'service', 'sharing', 'control']) {
  test(`${mode}: locale changes preserve iframe identity, settings and current mission`, async () => {
    let language = 'ja';
    const window = createWindow();
    const sent = [];
    const peer = { postMessage(data, origin) { sent.push({ data, origin }); } };
    const iframeNode = { contentWindow: peer };
    function MissionBusiness(props) { return React.createElement('business-panel', props); }
    const { LiveMissionWorkspace } = await compile(`
      const { useState, useRef, useEffect } = React;
      ${workspaceSource}
      export { LiveMissionWorkspace };
    `, { window, ORIGIN, CHANNEL, useSim: () => ({ lang: language }), MissionBusiness });
    let renderer;
    await act(() => {
      renderer = TestRenderer.create(React.createElement(LiveMissionWorkspace, { mode }), {
        createNodeMock: element => element.type === 'iframe' ? iframeNode : null,
      });
    });
    const iframe = renderer.root.findByType('iframe');
    const originalSrc = iframe.props.src;
    assert.ok(originalSrc.includes(`mission=${mode}&language=ja`));
    assert.equal(sent.at(-1).data.language, 'ja');

    const snapshot = {
      channel: CHANNEL, type: 'workspace.snapshot', mode, phase: 'running',
      eventCount: 7,
      rects: { before: { x: 10, y: 10, width: 240, height: 300 }, after: { x: 260, y: 10, width: 240, height: 300 } },
    };
    await act(() => window.dispatch(snapshot, peer));
    let panels = renderer.root.findAllByType('business-panel');
    assert.equal(panels.length, 2);
    const key = mode === 'control' ? 'fare' : 'demand';
    await act(() => panels[1].props.onPatch({ [key]: 321 }));
    panels = renderer.root.findAllByType('business-panel');
    assert.equal(panels[0].props.controlledSnapshot.settings[key], 321);
    assert.equal(panels[1].props.controlledSnapshot.settings[key], 321);
    const revision = panels[0].props.controlledSnapshot.revision;

    language = 'en';
    await act(() => renderer.update(React.createElement(LiveMissionWorkspace, { mode })));
    assert.equal(renderer.root.findByType('iframe'), iframe);
    assert.equal(renderer.root.findByType('iframe').props.src, originalSrc);
    assert.equal(sent.at(-1).data.language, 'en');
    assert.equal(sent.at(-1).data.revision, revision);
    assert.equal(sent.at(-1).origin, ORIGIN);
    panels = renderer.root.findAllByType('business-panel');
    assert.equal(panels[0].props.controlledSnapshot.phase, 'running');
    assert.equal(panels[0].props.controlledSnapshot.eventCount, 7);
    assert.equal(panels[0].props.controlledSnapshot.settings[key], 321);

    // The iframe's recurring handshake must also receive the current locale,
    // even when no setting changed since the previous handshake.
    await act(() => window.dispatch(snapshot, peer));
    assert.equal(sent.at(-1).data.language, 'en');
    assert.equal(sent.at(-1).data.revision, revision);
    const previousCount = sent.length;
    await act(() => window.dispatch({ ...snapshot, eventCount: 99 }, {}, ORIGIN));
    await act(() => window.dispatch({ ...snapshot, eventCount: 99 }, peer, 'https://untrusted.example'));
    await act(() => window.dispatch({ ...snapshot, eventCount: 99, mode: 'other' }, peer));
    assert.equal(sent.length, previousCount);
    assert.equal(renderer.root.findAllByType('business-panel')[0].props.controlledSnapshot.eventCount, 7);
    await act(() => renderer.unmount());
    assert.equal(window.listenerCount, 0);
  });
}

test('demo layout uses remaining viewport space without a fixed header assumption', async () => {
  let pathname = '/demo/sharing';
  const icon = () => React.createElement('span');
  const iconNames = ['LayoutDashboard', 'GitCompareArrows', 'Calculator', 'BookOpen', 'Play', 'Globe', 'RotateCcw', 'FlaskConical', 'FileText', 'ShieldAlert', 'Route'];
  const source = layout.replace(/^import .*?;\n/gm, '');
  const { default: Layout } = await compile(source, {
    ...Object.fromEntries(iconNames.map(name => [name, icon])),
    Link: ({ children, ...props }) => React.createElement('a', props, children),
    Outlet: () => React.createElement('outlet'),
    useLocation: () => ({ pathname }),
    useSim: () => ({ t: key => key, lang: 'ja', setLang() {}, run() {}, resetDefaults() {} }),
  });
  let renderer;
  await act(() => { renderer = TestRenderer.create(React.createElement(Layout)); });
  assert.match(renderer.toJSON().props.className, /h-dvh overflow-hidden/);
  const main = renderer.root.findByType('main');
  assert.match(main.props.className, /flex-1 min-h-0 overflow-hidden/);
  assert.equal(main.props.style, undefined);
  assert.match(renderer.root.findByType('header').props.className, /flex-shrink-0/);
  assert.match(renderer.root.findByType('aside').props.className, /md:overflow-y-auto/);
  assert.deepEqual([...new Set(renderer.root.findAllByType('a').map(a => a.props.to).filter(to => to.startsWith('/demo/')))].sort(),
    ['/demo/city', '/demo/control', '/demo/service', '/demo/sharing']);
  pathname = '/planning';
  await act(() => renderer.update(React.createElement(Layout)));
  assert.match(renderer.toJSON().props.className, /min-h-screen/);
  assert.doesNotMatch(renderer.toJSON().props.className, /h-dvh/);
  assert.match(renderer.root.findByType('main').props.className, /overflow-auto p-4 md:p-6/);
  await act(() => renderer.unmount());
});
