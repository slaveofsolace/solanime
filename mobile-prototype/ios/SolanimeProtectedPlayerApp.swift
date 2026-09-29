import SwiftUI
import WebKit

@main
struct SolanimeProtectedPlayerApp: App {
    var body: some Scene {
        WindowGroup {
            ProtectedRootView()
                .background(Color.black)
                .ignoresSafeArea(edges: .bottom)
                .preferredColorScheme(.dark)
        }
    }
}

private struct ProtectedRootView: View {
    @State private var failure: String?
    @State private var loaded = false
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
                        loaded = false
                        attempt += 1
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(32)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            } else {
                ZStack {
                    ProtectedSiteView(onFailure: { failure = $0 }, onLoad: {
                        withAnimation(.easeOut(duration: 0.2)) { loaded = true }
                    })
                    .id(attempt)

                    if !loaded {
                        NativeLoadingView()
                            .transition(.opacity)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
    }
}

private struct NativeLoadingView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image("SolanimeMark")
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 120)
                .accessibilityHidden(true)
            Text("Solanime")
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
            ProgressView()
                .tint(Color(red: 1, green: 0.58, blue: 0.13))
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                Color(red: 0.027, green: 0.031, blue: 0.071)
                RadialGradient(
                    colors: [Color.orange.opacity(0.12), .clear],
                    center: .center,
                    startRadius: 20,
                    endRadius: 270
                )
            }
            .ignoresSafeArea()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Opening Solanime")
    }
}

private enum DocumentPolicy {
    static var start: URL {
#if DEBUG
        // Installed development builds open the reviewed preview UI. Release
        // builds continue to use the canonical production origin.
        // Device diagnostics can open an exact watch route without weakening
        // the document policy or changing the release app's entry point.
        let argumentPrefix = "--solanime-watch-url="
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(argumentPrefix) }),
           let url = URL(string: String(argument.dropFirst(argumentPrefix.count))),
           url.path.hasPrefix("/watch/"), permits(url, mainFrame: true) {
            return url
        }
        return URL(string: "https://cloud-release.solanime.pages.dev/")!
#else
        return URL(string: "https://solanime.pages.dev/")!
#endif
    }

    static func permits(_ url: URL?, mainFrame: Bool) -> Bool {
        guard let url else { return false }
        if !mainFrame && url.absoluteString == "about:blank" { return true }
        guard url.scheme?.lowercased() == "https",
              url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              let host = url.host?.lowercased() else { return false }
        if host == "solanime.pages.dev" { return true }
#if DEBUG
        if host == "cloud-release.solanime.pages.dev" { return true }
#endif
        if mainFrame { return false }
        return host == "megaplay.buzz" || host == "www.youtube-nocookie.com"
    }
}

struct ProtectedSiteView: UIViewRepresentable {
    let onFailure: (String) -> Void
    let onLoad: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure, onLoad: onLoad) }

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
        let onLoad: () -> Void
        var initialNavigation: WKNavigation?
        private var rejectedWindowCount = 0

        init(onFailure: @escaping (String) -> Void, onLoad: @escaping () -> Void) {
            self.onFailure = onFailure
            self.onLoad = onLoad
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if navigation === initialNavigation { onLoad() }
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
