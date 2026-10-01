import XCTest

final class SignInUITests: XCTestCase {
    private let titleName = "You and I Are Polar Opposites Season 2"

    private func requires(_ element: XCUIElement, _ message: String, timeout: TimeInterval = 25) -> Bool {
        let appeared = element.waitForExistence(timeout: timeout)
        XCTAssertTrue(appeared, message)
        return appeared
    }

    private func assertRouteHealthy(_ webView: XCUIElement) {
        XCTAssertFalse(webView.staticTexts["Page not found"].exists)
        XCTAssertFalse(webView.staticTexts["Could not check access"].exists)
        XCTAssertFalse(webView.staticTexts["Could not restore your account"].exists)
    }

    func testAuthenticatedIOSAppSmoke() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let email = environment["SOLANIME_TEST_EMAIL"], !email.isEmpty,
              let password = environment["SOLANIME_TEST_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("Test credentials were not supplied to the UI test runner.")
        }

        let app = XCUIApplication()
        // The Debug app accepts an exact production watch route as a launch
        // argument. Private-site routing sends guests to the normal sign-in UI.
        app.launchArguments = ["--solanime-watch-url=https://solanime.pages.dev/watch/test/0"]
        app.launch()

        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The protected site did not open.")

        let emailField = webView.textFields.firstMatch
        let passwordField = webView.secureTextFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 30), "The sign-in email field did not appear.")
        XCTAssertTrue(passwordField.exists, "The sign-in password field did not appear.")
        emailField.tap()
        emailField.typeText(email)
        passwordField.tap()
        passwordField.typeText(password)

        let signIn = webView.buttons["Sign in"].firstMatch
        XCTAssertTrue(signIn.exists, "The sign-in button did not appear.")
        signIn.tap()

        // Successful sign-in moves to profile selection. The test account has
        // one default profile; choose it if this device has not selected it yet.
        let profile = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Open profile")
        ).firstMatch
        if profile.waitForExistence(timeout: 20) {
            profile.tap()
        }

        let home = webView.links["Sol Anime home"].firstMatch
        guard home.waitForExistence(timeout: 30) else {
            XCTFail("Private navigation did not appear after sign-in.")
            return
        }
        home.tap()

        let heading = webView.staticTexts["Explore anime"].firstMatch
        guard requires(heading, "Private Home did not appear after sign-in.") else { return }
        XCTAssertFalse(webView.textFields.firstMatch.exists, "The sign-in form is still visible.")
        assertRouteHealthy(webView)

        let discover = webView.links["Discover"].firstMatch
        guard requires(discover, "Discover navigation is missing.") else { return }
        discover.tap()
        let searchField = webView.searchFields.firstMatch
        guard requires(searchField, "Discover search did not appear.") else { return }
        assertRouteHealthy(webView)
        searchField.tap()
        searchField.typeText("Polar Opposites")
        let searchButton = webView.buttons["Search catalogue"].firstMatch
        guard requires(searchButton, "Catalogue search button is missing.") else { return }
        searchButton.tap()

        let titleLink = webView.links["Open \(titleName)"].firstMatch
        guard requires(titleLink, "Search did not return the reviewed title.", timeout: 30) else { return }
        titleLink.tap()
        guard requires(webView.staticTexts["Episodes"].firstMatch, "Title detail did not show episodes.") else { return }
        assertRouteHealthy(webView)

        let start = webView.links.matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", "Start watching:")
        ).firstMatch
        guard requires(start, "Title watch entry is missing.") else { return }
        start.tap()
        let episodePicker = webView.descendants(matching: .any)["Choose episode"].firstMatch
        let sourcePicker = webView.descendants(matching: .any)["Playback source"].firstMatch
        guard requires(episodePicker, "Watch episode picker is missing.", timeout: 30),
              requires(sourcePicker, "Watch source picker is missing.", timeout: 30) else { return }
        XCTAssertTrue(sourcePicker.isEnabled, "Watch source picker has no usable source.")
        assertRouteHealthy(webView)

        let backToTitle = webView.links["Back to title"].firstMatch
        guard requires(backToTitle, "Watch return link is missing.") else { return }
        backToTitle.tap()
        guard requires(webView.staticTexts["Episodes"].firstMatch, "Back navigation did not return to title.") else { return }
        assertRouteHealthy(webView)

        let library = webView.links["Library"].firstMatch
        guard requires(library, "Library navigation is missing.") else { return }
        library.tap()
        guard requires(webView.staticTexts["Watch history"].firstMatch, "Library did not open.") else { return }
        guard requires(webView.staticTexts["My List"].firstMatch, "Library list section is missing.") else { return }
        assertRouteHealthy(webView)

        let accountTab = webView.links["Account"].firstMatch
        guard requires(accountTab, "Account navigation is missing.") else { return }
        accountTab.tap()
        guard requires(webView.staticTexts["Your profiles"].firstMatch, "Account did not open.") else { return }
        assertRouteHealthy(webView)

        let settings = webView.links["Settings"].firstMatch
        guard requires(settings, "Settings navigation is missing.") else { return }
        settings.tap()
        guard requires(webView.staticTexts["Preferred version"].firstMatch, "Settings did not open.") else { return }
        assertRouteHealthy(webView)

        let switchProfile = webView.links.matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", "Switch profile. Current profile:")
        ).firstMatch
        guard requires(switchProfile, "Profile switch control is missing.") else { return }
        switchProfile.tap()
        guard requires(webView.staticTexts["Who’s watching?"].firstMatch, "Profile selector did not open.") else { return }
        let selectedProfile = webView.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "Current profile", "Open profile")
        ).firstMatch
        guard requires(selectedProfile, "Default profile cannot be selected.") else { return }
        selectedProfile.tap()
        guard requires(webView.staticTexts["Preferred version"].firstMatch, "Profile return did not restore Settings.") else { return }
        assertRouteHealthy(webView)

        let backHome = webView.links["Sol Anime home"].firstMatch
        guard requires(backHome, "Home return navigation is missing.") else { return }
        backHome.tap()
        XCTAssertTrue(heading.waitForExistence(timeout: 25), "Final navigation did not return to private Home.")
        assertRouteHealthy(webView)
    }
}
