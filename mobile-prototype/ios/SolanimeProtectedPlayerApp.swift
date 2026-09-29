import SwiftUI
import WebKit

@main
struct SolanimeProtectedPlayerApp: App {
    var body: some Scene {
        WindowGroup {
            ProtectedSiteView()
                .background(Color.black)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

private enum DocumentPolicy {
    static let start = URL(string: "https://solanime.pages.dev/")!

    static func permits(_ url: URL?, mainFrame: Bool) -> Bool {
        guard let url else { return false }
        if !mainFrame && url.absoluteString == "about:blank" { return true }
        guard url.scheme?.lowercased() == "https",
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              let host = url.host?.lowercased() else { return false }
        if host == "solanime.pages.dev" { return true }
        if mainFrame { return false }
        return host == "megaplay.buzz" || host == "www.youtube-nocookie.com"
    }
}

struct ProtectedSiteView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // No WKScriptMessageHandler or native bridge is exposed to provider frames.
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        // Secondary, exact-host filter for the ad destination observed in the Android click trace.
        // Compile before loading; a rule failure must not silently start an unfiltered player.
        let rules = #"[{"trigger":{"url-filter":"^https?://([a-z0-9-]+[.])*wuytg[.]com([:/]|$)"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "solanime-observed-ad-20260928",
            encodedContentRuleList: rules
        ) { rule, error in
            DispatchQueue.main.async {
                guard let rule, error == nil else {
                    NSLog("Solanime prototype content rule failed; player remains unloaded")
                    return
                }
                view.configuration.userContentController.add(rule)
                view.load(URLRequest(url: DocumentPolicy.start))
            }
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private var rejectedWindowCount = 0

        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // A nil target is a new window, not a reason to load the URL in this view.
            guard let frame = action.targetFrame else {
                rejectedWindowCount += 1
                NSLog("Solanime prototype rejected new-window navigation; count=%d", rejectedWindowCount)
                decisionHandler(.cancel)
                return
            }
            let allow = DocumentPolicy.permits(action.request.url, mainFrame: frame.isMainFrame)
            if !allow {
                NSLog("Solanime prototype rejected document navigation; host=%@; mainFrame=%d",
                      action.request.url?.host ?? "none", frame.isMainFrame ? 1 : 0)
            }
            decisionHandler(allow ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor response: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            // Recheck the final document URL after redirects.
            let allow = DocumentPolicy.permits(response.response.url, mainFrame: response.isForMainFrame)
            if !allow {
                NSLog("Solanime prototype rejected redirected document; host=%@",
                      response.response.url?.host ?? "none")
            }
            decisionHandler(allow ? .allow : .cancel)
        }

        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            rejectedWindowCount += 1
            NSLog("Solanime prototype rejected new WebView; count=%d", rejectedWindowCount)
            return nil
        }
    }
}
