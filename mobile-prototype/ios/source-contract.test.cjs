'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const swift = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayerApp.swift'), 'utf8');
const project = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayer.xcodeproj', 'project.pbxproj'), 'utf8');
const scheme = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayer.xcodeproj', 'xcshareddata', 'xcschemes', 'SolanimeProtectedPlayer.xcscheme'), 'utf8');

test('the iPhone app compiles protection rules before loading the site', () => {
  const match = swift.match(/let rules = #"(.*)"#/);
  assert.ok(match, 'content rules must be present');
  const rules = JSON.parse(match[1]);
  assert.deepEqual(rules[0].trigger['resource-type'], ['popup']);
  assert.equal(rules[0].action.type, 'block');
  assert.match(swift, /guard let rule, error == nil else/);
  assert.ok(swift.indexOf('userContentController.add(rule)') < swift.indexOf('view.load(URLRequest'));
  assert.match(swift, /createWebViewWith[\s\S]*?return nil/);
  assert.match(swift, /guard let frame = action.targetFrame else[\s\S]*?decisionHandler\(\.cancel\)/);
});

test('the Xcode project includes the app source and an iPhone target', () => {
  const defined = [...project.matchAll(/(A001[0-9A-F]{20})\s+\/\*[^*]*\*\/\s*=\s*\{/g)]
    .map(match => match[1]);
  assert.ok(defined.length >= 12);
  assert.equal(new Set(defined).size, defined.length);
  assert.match(project, /SolanimeProtectedPlayerApp\.swift in Sources/);
  assert.match(project, /TARGETED_DEVICE_FAMILY = 1;/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = dev\.solanime\.protectedplayer\.preview;/);
  assert.match(scheme, /BlueprintIdentifier="A00100000000000000000007"/);
  assert.match(scheme, /BuildableName="Solanime Protected\.app"/);
});
