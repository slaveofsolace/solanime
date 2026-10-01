'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const swift = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayerApp.swift'), 'utf8');
const project = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayer.xcodeproj', 'project.pbxproj'), 'utf8');
const scheme = fs.readFileSync(path.join(__dirname, 'SolanimeProtectedPlayer.xcodeproj', 'xcshareddata', 'xcschemes', 'SolanimeProtectedPlayer.xcscheme'), 'utf8');
const launchScreen = fs.readFileSync(path.join(__dirname, 'LaunchScreen.storyboard'), 'utf8');
const infoPlist = fs.readFileSync(path.join(__dirname, 'Info.plist'), 'utf8');

test('the iPhone app installs protection rules before loading the site', () => {
  const match = swift.match(/let rules = #"(.*)"#/);
  assert.ok(match, 'content rules must be present');
  const rules = JSON.parse(match[1]);
  assert.deepEqual(rules[0].trigger['resource-type'], ['popup']);
  assert.equal(rules[0].action.type, 'block');
  const adFilter = new RegExp(rules[1].trigger['url-filter']);
  assert.match('https://wuytg.com/', adFilter);
  assert.match('https://ads.wuytg.com/path', adFilter);
  assert.doesNotMatch('https://wuytg.com.evil.example/', adFilter);
  assert.doesNotMatch('https://notwuytg.com/', adFilter);
  assert.match(swift, /guard let rule, error == nil else/);
  assert.ok(swift.indexOf('userContentController.add(rule)') < swift.indexOf('view.load(URLRequest'));
  assert.match(swift, /createWebViewWith[\s\S]*?return nil/);
  assert.match(swift, /guard let frame = action.targetFrame else[\s\S]*?decisionHandler\(\.cancel\)/);
  assert.match(swift, /#if DEBUG[\s\S]*?https:\/\/cloud-release\.solanime\.pages\.dev\/[\s\S]*?#else[\s\S]*?https:\/\/solanime\.pages\.dev\//);
  assert.match(swift, /if host == "cloud-release\.solanime\.pages\.dev" \{ return true \}[\s\S]*?#endif/);
  assert.match(swift, /solanime-native-ios/);
  assert.match(swift, /forMainFrameOnly: true/);
  assert.doesNotMatch(swift, /addScriptMessageHandler\(/);
});

test('iOS media configuration permits system PiP and AirPlay without autoplay or provider-frame scripting', () => {
  assert.match(swift, /allowsPictureInPictureMediaPlayback = true/);
  assert.match(swift, /allowsAirPlayForMediaPlayback = true/);
  assert.match(swift, /setCategory\(\.playback, mode: \.moviePlayback\)/);
  assert.match(swift, /mediaTypesRequiringUserActionForPlayback = \.all/);
  assert.match(project, /INFOPLIST_FILE = Info\.plist;/);
  assert.match(infoPlist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>\s*<\/array>/);
  assert.match(swift, /forMainFrameOnly: true/);
  assert.doesNotMatch(swift, /AVPictureInPictureController|evaluateJavaScript|addScriptMessageHandler\(/);
});

test('the native AirPlay picker appears only on a permitted watch route', () => {
  assert.match(swift, /AVRoutePickerView\(\)/);
  assert.match(swift, /prioritizesVideoDevices = true/);
  assert.match(swift, /if loaded && onWatchRoute/);
  assert.match(swift, /view\.observe\(\\\.url, options: \[\.initial, \.new\]/);
  assert.match(swift, /DocumentPolicy\.permits\(webView\.url, mainFrame: true\)/);
  assert.match(swift, /webView\.url\?\.path\.hasPrefix\("\/watch\/"\)/);
  assert.doesNotMatch(swift, /addScriptMessageHandler\(|evaluateJavaScript/);
});

test('the Xcode project includes the app source and an iPhone target', () => {
  const defined = [...project.matchAll(/(A001[0-9A-F]{20})\s+\/\*[^*]*\*\/\s*=\s*\{/g)]
    .map(match => match[1]);
  assert.ok(defined.length >= 12);
  assert.equal(new Set(defined).size, defined.length);
  assert.match(project, /SolanimeProtectedPlayerApp\.swift in Sources/);
  assert.match(project, /TARGETED_DEVICE_FAMILY = 1;/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = dev\.solanime\.protectedplayer\.preview;/);
  assert.match(scheme, /BlueprintIdentifier\s*=\s*"A00100000000000000000007"/);
  assert.match(scheme, /BuildableName\s*=\s*"Solanime\.app"/);
  assert.match(project, /PRODUCT_NAME = Solanime;/);
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/);
  assert.match(project, /INFOPLIST_KEY_CFBundleDisplayName = Solanime;/);
  assert.match(project, /INFOPLIST_KEY_UILaunchStoryboardName = LaunchScreen;/);
  assert.match(launchScreen, /initialViewController="SL0-00-002"/);
  assert.match(launchScreen, /image="SolanimeMark"/);
  assert.match(project, /SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;/);
});
