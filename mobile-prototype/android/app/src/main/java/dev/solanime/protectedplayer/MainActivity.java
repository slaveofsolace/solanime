package dev.solanime.protectedplayer;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;

/** Isolated proof of native popup containment; not a production browser or a playback pass. */
public final class MainActivity extends Activity {
    private static final String TAG = "SolanimePrototype";
    private FrameLayout root;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int rejectedWindowCount;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (NavigationPolicy.permits(request.getUrl(), request.isForMainFrame())) return false;
                Log.w(TAG, "Rejected document navigation; host=" + request.getUrl().getHost()
                        + "; mainFrame=" + request.isForMainFrame());
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (NavigationPolicy.isObservedAdHost(request.getUrl())) {
                    Log.w(TAG, "Rejected observed ad request");
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                            null, new ByteArrayInputStream(new byte[0]));
                }
                if (!request.isForMainFrame() || NavigationPolicy.permits(request.getUrl(), true)) return null;
                Log.w(TAG, "Rejected main-document request");
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                        null, new ByteArrayInputStream(new byte[0]));
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!NavigationPolicy.permits(android.net.Uri.parse(url), true)) {
                    view.stopLoading();
                    Log.e(TAG, "Unexpected main-document start; stopping player");
                    return;
                }
                super.onPageStarted(view, url, favicon);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                    boolean isUserGesture, Message resultMsg) {
                // Do not send resultMsg or create a hidden WebView. User gestures are not an exception.
                rejectedWindowCount += 1;
                Log.w(TAG, "Rejected new window; count=" + rejectedWindowCount
                        + "; userGesture=" + isUserGesture);
                return false;
            }

            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                webView.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }

            @Override public void onHideCustomView() {
                closeFullscreen();
            }
        });
        webView.loadUrl(NavigationPolicy.SITE);
    }

    private void closeFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        webView.setVisibility(View.VISIBLE);
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }

    @Override public void onBackPressed() {
        if (fullscreenView != null) closeFullscreen();
        else if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override protected void onDestroy() {
        closeFullscreen();
        root.removeView(webView);
        webView.stopLoading();
        webView.destroy();
        super.onDestroy();
    }
}
