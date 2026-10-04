import SwiftUI
import WebKit
import AVFoundation
import AVKit

@main
struct SolanimeProtectedPlayerApp: App {
    init() {
        // WebKit owns the media player. Set the app's audio category before it
        // starts playback so iOS can keep eligible video active in PiP/AirPlay.
        // Do not activate the session here: opening the catalogue should not
        // interrupt audio from another app before the user presses Play.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        } catch {
            NSLog("Solanime could not configure its playback audio session: %@", String(describing: error))
        }
    }

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
    @State private var onWatchRoute = false

    var body: some View {
        Group {
            if let failure {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.shield.fill")
                        .font(.system(size: 36, weight: .regular))
                        .foregroundStyle(Color(red: 1, green: 0.54, blue: 0.16))
                        .accessibilityHidden(true)
                    Text("Solanime could not start safely")
                        .font(.title3.weight(.semibold))
                    Text(failure)
                        .font(.body)
                        .multilineTextAlignment(.center)
                    Button("Retry") {
                        self.failure = nil
                        loaded = false
                        onWatchRoute = false
                        attempt += 1
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 1, green: 0.54, blue: 0.16))
                    .controlSize(.large)
                }
                .padding(32)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black)
            } else {
                ZStack(alignment: .topTrailing) {
                    ProtectedSiteView(onFailure: { failure = $0 }, onLoad: {
                        withAnimation(.easeOut(duration: 0.2)) { loaded = true }
                    }, onWatchRouteChange: { onWatchRoute = $0 })
                    .id(attempt)

                    if loaded && onWatchRoute {
                        // Sits in the watch screen's top bar, which reserves
                        // this corner in the iPhone app, not over the video.
                        AirPlayRoutePicker()
                            .frame(width: 44, height: 44)
                            .padding(.top, 2)
                            .padding(.trailing, 8)
                            .accessibilityLabel("Choose AirPlay device")
                    }

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

private struct AirPlayRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.prioritizesVideoDevices = true
        picker.tintColor = .white
        picker.activeTintColor = .systemOrange
        picker.backgroundColor = .clear
        return picker
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

private struct NativeLoadingView: View {
    var body: some View {
        ZStack {
            Image("SolanimeMark")
                .resizable()
                .scaledToFit()
                .frame(width: 68, height: 68)
                .accessibilityHidden(true)
            ProgressView()
                .tint(Color(red: 1, green: 0.58, blue: 0.13))
                .offset(y: 68)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
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
    let onWatchRouteChange: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFailure: onFailure, onLoad: onLoad, onWatchRouteChange: onWatchRouteChange)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // Style only the app's first-party main document with iOS controls and
        // spacing. Provider frames receive no script, message handler, or bridge.
        configuration.userContentController.addUserScript(WKUserScript(
            // The app is not a page to pinch-zoom: lock the viewport scale so
            // taps on controls never zoom the interface.
            source: "(() => { const mark = () => document.documentElement?.classList.add('solanime-native-ios'); const lock = () => { const meta = document.querySelector('meta[name=viewport]'); if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'); }; mark(); document.addEventListener('DOMContentLoaded', () => { mark(); lock(); }, { once: true }); })();",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        // No WKScriptMessageHandler or native bridge is exposed to provider frames.
        let view = WKWebView(frame: .zero, configuration: configuration)
#if DEBUG
        if #available(iOS 16.4, *) {
            view.isInspectable = true
        }
#endif
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.urlObservation = view.observe(\.url, options: [.initial, .new]) { [weak coordinator = context.coordinator] webView, _ in
            let onWatchRoute = DocumentPolicy.permits(webView.url, mainFrame: true)
                && webView.url?.path.hasPrefix("/watch/") == true
            DispatchQueue.main.async {
                coordinator?.onWatchRouteChange(onWatchRoute)
                webView.scrollView.refreshControl = onWatchRoute ? nil : coordinator?.refreshControl
            }
        }
        view.allowsBackForwardNavigationGestures = true
        // Long-pressing a title should not open a Safari link preview.
        view.allowsLinkPreview = false
        // Pull down to refresh, as in other iOS apps. It is removed on watch
        // routes so a downward swipe never reloads a playing episode.
        let refresh = UIRefreshControl()
        refresh.tintColor = .white
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        context.coordinator.refreshControl = refresh
        context.coordinator.webView = view
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
        let onWatchRouteChange: (Bool) -> Void
        var initialNavigation: WKNavigation?
        var urlObservation: NSKeyValueObservation?
        var refreshControl: UIRefreshControl?
        private var rejectedWindowCount = 0

        weak var webView: WKWebView?

        @objc func refresh(_ control: UIRefreshControl) {
            guard let webView else {
                control.endRefreshing()
                return
            }
            webView.reload()
        }

        init(onFailure: @escaping (String) -> Void,
             onLoad: @escaping () -> Void,
             onWatchRouteChange: @escaping (Bool) -> Void) {
            self.onFailure = onFailure
            self.onLoad = onLoad
            self.onWatchRouteChange = onWatchRouteChange
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshControl?.endRefreshing()
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
            refreshControl?.endRefreshing()
            if navigation === initialNavigation {
                onFailure("The site did not load. Check your connection and retry.")
            }
        }
    }
}
