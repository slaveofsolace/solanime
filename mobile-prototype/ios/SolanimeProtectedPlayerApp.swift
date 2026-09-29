import SwiftUI
import WebKit

@main
struct SolanimeProtectedPlayerApp: App {
    var body: some Scene {
        WindowGroup {
            ProtectedRootView()
                .background(Color.black)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

private struct ProtectedRootView: View {
    @State private var failure: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let failure {
                VStack(spacing: 16) {
                    Text("Solanime could not start safely")
                        .font(.headline)
                    Text(failure)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        self.failure = nil
                        attempt += 1
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(32)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            } else {
                ProtectedSiteView(onFailure: { failure = $0 })
                    .id(attempt)
            }
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
    let onFailure: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // No WKScriptMessageHandler or native bridge is exposed to provider frames.
        let view = WKWebView(frame: .zero, configuration: configuration)
#if DEBUG
        if #available(iOS 16.4, *) {
            view.isInspectable = true
        }
#endif
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        // Block all popup resources before WebKit creates them, then reject any
        // remaining createWebView request in the UI delegate. Media hosts are not
        // blanket-blocked. The second rule is one observed ad destination.
        let rules = #"[{"trigger":{"url-filter":".*","resource-type":["popup"]},"action":{"type":"block"}},{"trigger":{"url-filter":"^https?://([a-z0-9-]+[.])*wuytg[.]com[/:]"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "solanime-native-guard-20260929",
            encodedContentRuleList: rules
        ) { rule, error in
            DispatchQueue.main.async {
                guard let rule, error == nil else {
                    context.coordinator.onFailure("The protection rules did not initialize. No provider page was loaded.")
                    return
                }
                view.configuration.userContentController.add(rule)
                context.coordinator.initialNavigation = view.load(URLRequest(url: DocumentPolicy.start))
            }
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let onFailure: (String) -> Void
        var initialNavigation: WKNavigation?
        private var rejectedWindowCount = 0

        init(onFailure: @escaping (String) -> Void) {
            self.onFailure = onFailure
        }

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

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if navigation === initialNavigation {
                onFailure("The site did not load. Check your connection and retry.")
            }
        }
    }
}
