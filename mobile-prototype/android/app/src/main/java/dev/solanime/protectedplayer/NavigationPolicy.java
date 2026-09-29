package dev.solanime.protectedplayer;

import android.net.Uri;
import java.util.Locale;

/** Document navigation only. Media subresources have a separate policy and are not opened as pages. */
final class NavigationPolicy {
    static final String SITE = "https://solanime.pages.dev/";

    private NavigationPolicy() {}

    static boolean permits(Uri uri, boolean mainFrame) {
        if (uri == null) return false;
        if (!mainFrame && "about".equalsIgnoreCase(uri.getScheme()) &&
                "blank".equalsIgnoreCase(uri.getSchemeSpecificPart())) return true;
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null) return false;
        if (uri.getPort() != -1 && uri.getPort() != 443) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if ("solanime.pages.dev".equals(host)) return true;
        if (mainFrame) return false;
        return "megaplay.buzz".equals(host) || "www.youtube-nocookie.com".equals(host);
    }

    static boolean isObservedAdHost(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        // Narrow secondary filter from the dated Android click trace; window rejection does not rely on it.
        return "wuytg.com".equals(host) || host.endsWith(".wuytg.com");
    }
}
