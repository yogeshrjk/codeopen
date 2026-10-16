'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

describe('extension manifest', () => {
  it('exposes only the own chat panel (no Copilot participant, no CLI picker)', () => {
    assert.ok(!pkg.contributes.chatParticipants, 'must not contribute a Copilot Chat participant');
    const views = (pkg.contributes.views && pkg.contributes.views.freecli) || [];
    assert.equal(views.length, 1);
    assert.equal(views[0].id, 'freecli.main');
    assert.equal(views[0].type, 'webview');
    const commands = (pkg.contributes.commands || []).map((c) => c.command);
    assert.ok(commands.includes('freecli.selectModel'));
    assert.ok(commands.includes('freecli.newSession'));
    assert.ok(!commands.includes('freecli.selectCLI'), 'no CLI selection command');
    assert.ok(!commands.includes('freecli.openChat'), 'no Copilot-chat opener');
    // Title-bar entries must be icons-only (no text buttons on top)
    for (const id of ['freecli.newSession', 'freecli.retryDetection', 'freecli.showHistory']) {
      const cmd = pkg.contributes.commands.find((c) => c.command === id);
      assert.ok(cmd.icon, `${id} must carry an icon for the title bar`);
    }
  });

  it('does not place model picker on top header (view/title)', () => {
    const titles = (pkg.contributes.menus && pkg.contributes.menus['view/title']) || [];
    assert.ok(!titles.some((t) => t.command === 'freecli.selectModel'), 'model picker must be removed from top view/title');
  });

  it('has CLI configuration with stall safeguards', () => {
    const props = pkg.contributes.configuration.properties;
    assert.ok(props['freecli.opencodePath']);
    assert.ok(!props['freecli.freebuffPath'], 'no freebuffPath setting');
    assert.ok(!props['freecli.defaultCLI'], 'no defaultCLI setting');
    assert.equal(props['freecli.requestTimeoutSec'].default, 300);
    assert.equal(props['freecli.firstByteNoticeSec'].default, 30);
  });

  it('references supported OpenCode CLI', () => {
    const text = JSON.stringify(pkg).toLowerCase();
    assert.ok(text.includes('opencode'), 'references OpenCode CLI');
    assert.ok(!text.includes('freebuff'), 'does not reference Freebuff CLI');
  });

  it('references shell icons (activity bar + marketplace)', () => {
    // Shell icons: package.json points at assets/, webview CSP forbids loading them.
    // Artwork itself is user-owned — this test only pins the wiring, not the pixels.
    assert.equal(pkg.icon, 'assets/icon.png');
    const container = (pkg.contributes.viewsContainers.activitybar || [])[0];
    assert.equal(container.icon, 'assets/activity-icon.svg');
    const pngPath = path.join(__dirname, '..', pkg.icon);
    const svgPath = path.join(__dirname, '..', container.icon);
    assert.ok(fs.existsSync(pngPath), 'marketplace icon exists');
    assert.ok(fs.existsSync(svgPath), 'activity icon exists');
    const svg = fs.readFileSync(svgPath, 'utf8');
    // Activity-bar icon is the user-owned frame mark: dark outer frame
    // with a light lower panel.
    assert.match(svg, /<svg[^>]*>.*<\/svg>/s);
    assert.ok(svg.includes('#222222'), 'activity icon has dark outer frame');
    assert.ok(svg.includes('#D0CECE'), 'activity icon has light lower panel');
    // Marketplace icon is user-owned artwork: must be a real PNG with dimensions.
    const png = fs.readFileSync(pngPath);
    assert.equal(png.readUInt32BE(0), 0x89504e47, 'PNG signature');
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'PNG has dimensions');
  });
});
