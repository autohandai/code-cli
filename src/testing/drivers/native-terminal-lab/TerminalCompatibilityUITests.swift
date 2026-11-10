import AppKit
import XCTest

final class TerminalCompatibilityUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor func testIdleResize() throws { try resizeScenario(streaming: false) }
    @MainActor func testStreamingResize() throws { try resizeScenario(streaming: true) }

    @MainActor
    private func resizeScenario(streaming: Bool) throws {
        guard environment["GITHUB_ACTIONS"] == "true",
              let terminal = environment["AUTOHAND_NATIVE_TERMINAL"],
              let application = environment["AUTOHAND_NATIVE_APPLICATION"],
              let fixture = environment["AUTOHAND_NATIVE_FIXTURE"],
              let profile = environment["AUTOHAND_NATIVE_PROFILE"] else {
            XCTFail("This scenario requires an isolated GitHub Actions macOS runner")
            return
        }
        continueAfterFailure = false
        let interruption = addUIInterruptionMonitor(withDescription: "Deny local network access for the offline terminal fixture") { alert in
            let text = ([alert.label] + alert.staticTexts.allElementsBoundByIndex.map(\.label)).joined(separator: "\n")
            guard text.contains("find devices on local networks") else { return false }
            for label in ["Don’t Allow", "Don't Allow"] {
                let deny = alert.buttons[label]
                if deny.exists {
                    deny.click()
                    print("NATIVE_TERMINAL_DENIED_LOCAL_NETWORK")
                    return true
                }
            }
            return false
        }
        defer { removeUIInterruptionMonitor(interruption) }
        let app = XCUIApplication(url: URL(fileURLWithPath: application))
        defer { if app.state != .notRunning { app.terminate() } }
        let command = "'" + fixture.replacingOccurrences(of: "'", with: "'\\''") + "'" + (streaming ? " --streaming" : "")
        if terminal == "ghostty" {
            app.launchArguments = ["--config-default-files=false", "--confirm-close-surface=false"]
        } else if terminal == "vscode" {
            app.launchArguments = ["--user-data-dir", profile, "--extensions-dir", profile + "/extensions", "--disable-extensions",
                                   "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--new-window"]
        }
        let launch = expectation(description: "Launch the installed terminal through macOS")
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.arguments = app.launchArguments
        configuration.environment = app.launchEnvironment
        configuration.createsNewApplicationInstance = true
        var launchError: Error?
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: application), configuration: configuration) { _, error in
            launchError = error
            launch.fulfill()
        }
        wait(for: [launch], timeout: 30)
        let desktop = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        desktop.name = "\(terminal)-launch"
        desktop.lifetime = .keepAlways
        add(desktop)
        XCTAssertNil(launchError)
        app.activate()
        let window = app.windows.firstMatch
        guard window.waitForExistence(timeout: 30) else {
            attachStartupFailure(app, terminal: terminal, phase: "window")
            XCTFail("The native terminal did not create a window")
            return
        }
        if terminal == "vscode" {
            guard app.webViews.firstMatch.waitForExistence(timeout: 30) else {
                attachStartupFailure(app, terminal: terminal, phase: "workbench")
                XCTFail("VS Code did not display its workbench")
                return
            }
            dismissCopilotSignIn(app)
            app.typeKey("`", modifierFlags: [.control, .shift])
        }
        let terminalView = app.textViews.firstMatch
        let terminalReady = NSPredicate { _, _ in
            if terminal == "vscode", self.dismissCopilotSignIn(app) {
                app.typeKey("`", modifierFlags: [.control, .shift])
                return false
            }
            return terminalView.exists
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: terminalReady, object: app)], timeout: 20) == .completed else {
            attachStartupFailure(app, terminal: terminal, phase: "terminal-view")
            XCTFail("The native terminal did not expose its terminal text view")
            return
        }
        terminalView.click()
        NSPasteboard.general.clearContents()
        XCTAssertTrue(NSPasteboard.general.writeObjects([command as NSString]))
        app.typeKey("v", modifierFlags: .command)
        app.typeKey(.return, modifierFlags: [])
        var startupValue = ""
        let ready = NSPredicate { _, _ in
            startupValue = self.terminalValue(app)
            return startupValue.contains("RESIZE_HISTORY retained text")
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: app)], timeout: 30) == .completed else {
            let text = XCTAttachment(string: String(startupValue.suffix(16_000)))
            text.name = "\(terminal)-startup-terminal"
            text.lifetime = .keepAlways
            add(text)
            let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screen.name = "\(terminal)-startup-screen"
            screen.lifetime = .keepAlways
            add(screen)
            XCTFail("The native terminal did not display the fixture history marker")
            return
        }
        for (index, delta) in [CGVector(dx: -160, dy: -100), CGVector(dx: 240, dy: 160),
                               CGVector(dx: -200, dy: -120), CGVector(dx: 160, dy: 100)].enumerated() {
            let frame = window.frame
            let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
            corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(delta))
            XCTAssertNotEqual(window.frame.size, frame.size, "The native window did not resize")
            let settled = NSPredicate { _, _ in
                let value = self.terminalValue(app)
                return value.contains("RESIZE_HISTORY retained text") && value.contains("preserved draft")
            }
            expectation(for: settled, evaluatedWith: app)
            waitForExpectations(timeout: 10)
            let content = terminalValue(app)
            XCTAssertEqual(content.components(separatedBy: "Autohand Code").count - 1, 1, content)
            XCTAssertEqual(content.components(separatedBy: "RESIZE_HISTORY retained text").count - 1, 1, content)
            XCTAssertEqual(content.components(separatedBy: "preserved draft").count - 1, 1, content)
            if streaming { XCTAssertTrue(content.contains("RESIZE_STREAM "), content) }
            let image = XCTAttachment(screenshot: window.screenshot())
            image.name = "\(terminal)-\(streaming ? "streaming" : "idle")-\(index)"
            image.lifetime = .keepAlways
            add(image)
        }
        app.typeKey(.leftArrow, modifierFlags: [])
        app.typeKey(.leftArrow, modifierFlags: [])
        app.typeKey("x", modifierFlags: .shift)
        let edited = NSPredicate { _, _ in self.terminalValue(app).contains("taXil") }
        expectation(for: edited, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        let exit = NSPredicate { _, _ in self.terminalValue(app).contains("RESIZE_PTY_EXIT") || app.state == .notRunning }
        expectation(for: exit, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        print(streaming ? "NATIVE_TERMINAL_STREAMING_PASS" : "NATIVE_TERMINAL_IDLE_PASS")
    }

    @discardableResult
    private func dismissCopilotSignIn(_ app: XCUIApplication) -> Bool {
        let dialog = app.groups.matching(NSPredicate(format: "label == %@", "Info Sign in to use GitHub Copilot")).firstMatch
        guard dialog.exists else { return false }
        let close = dialog.buttons["Close Dialog"]
        guard close.exists, close.isHittable else { return false }
        close.click()
        print("NATIVE_TERMINAL_DISMISSED_COPILOT_SIGN_IN")
        return true
    }

    @MainActor
    private func attachStartupFailure(_ app: XCUIApplication, terminal: String, phase: String) {
        let hierarchy = XCTAttachment(string: String(app.debugDescription.suffix(16_000)))
        hierarchy.name = "\(terminal)-startup-\(phase)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screen.name = "\(terminal)-startup-\(phase)-screen"
        screen.lifetime = .keepAlways
        add(screen)
    }

    private func terminalValue(_ app: XCUIApplication) -> String {
        let values = app.textViews.allElementsBoundByIndex.compactMap { $0.value as? String }
        if let terminal = values.filter({ $0.contains("RESIZE_HISTORY retained text") }).max(by: { $0.count < $1.count }) {
            return terminal
        }
        if environment["AUTOHAND_NATIVE_TERMINAL"] == "vscode" {
            return app.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: "\n")
        }
        return values.max(by: { $0.count < $1.count }) ?? ""
    }
}
