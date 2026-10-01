import Foundation
import WebKit

let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("SolanimeProtectedPlayerApp.swift")
let source = try String(contentsOf: sourceURL, encoding: .utf8)
guard let start = source.range(of: "let rules = #\""),
      let end = source.range(of: "\"#", range: start.upperBound..<source.endIndex) else {
    fputs("Could not locate the app's content rules.\n", stderr)
    exit(1)
}

let rules = String(source[start.upperBound..<end.lowerBound])
let identifier = "solanime-native-guard-validation-\(ProcessInfo.processInfo.processIdentifier)"
var completed = false
var succeeded = false

WKContentRuleListStore.default().compileContentRuleList(
    forIdentifier: identifier,
    encodedContentRuleList: rules
) { rule, error in
    succeeded = rule != nil && error == nil
    completed = true
    if let error {
        fputs("WebKit content-rule compilation failed: \(error)\n", stderr)
    }
    CFRunLoopStop(CFRunLoopGetMain())
}

let deadline = Date().addingTimeInterval(15)
while !completed && Date() < deadline {
    _ = RunLoop.main.run(mode: .default, before: deadline)
}
guard completed && succeeded else {
    if !completed { fputs("WebKit content-rule compilation timed out.\n", stderr) }
    exit(1)
}
print("WebKit content rules compiled successfully.")
