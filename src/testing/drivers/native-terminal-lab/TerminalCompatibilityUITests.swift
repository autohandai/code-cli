import AppKit
import XCTest

final class TerminalCompatibilityUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    func testIdleResize() throws { try resizeScenario(streaming: false) }
    func testStreamingResize() throws { try resizeScenario(streaming: true) }

    private func resizeScenario(streaming: Bool) throws {
        guard environment["GITHUB_ACTIONS"] == "true",
              let terminal = environment["AUTOHAND_NATIVE_TERMINAL"],
              let fixture = environment["AUTOHAND_NATIVE_FIXTURE"],
              let profile = environment["AUTOHAND_NATIVE_PROFILE"] else {
            XCTFail("This scenario requires an isolated GitHub Actions macOS runner")
            return
        }
        continueAfterFailure = false
        let bundles = ["iterm2": "com.googlecode.iterm2", "ghostty": "com.mitchellh.ghostty",
                       "cmux": "com.cmuxterm.app", "vscode": "com.microsoft.VSCode"]
        let bundle = try XCTUnwrap(bundles[terminal])
        let app = XCUIApplication(bundleIdentifier: bundle)
        defer { app.terminate() }
        let command = "'" + fixture.replacingOccurrences(of: "'", with: "'\\''") + "'" + (streaming ? " --streaming" : "")
        if terminal == "ghostty" {
            app.launchArguments = ["--config-default-files=false", "--confirm-close-surface=false", "-e", "/bin/sh", "-c", command]
        } else if terminal == "vscode" {
            app.launchArguments = ["--user-data-dir", profile, "--extensions-dir", profile + "/extensions", "--disable-extensions",
                                   "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--new-window"]
        }
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 30), app.debugDescription)
        if terminal != "ghostty" {
            if terminal == "vscode" { app.typeKey("`", modifierFlags: .control) }
            let terminalView = app.textViews.firstMatch
            XCTAssertTrue(terminalView.waitForExistence(timeout: 20), app.debugDescription)
            app.typeText(command + "\n")
        }
        let ready = NSPredicate { _, _ in self.terminalValue(app).contains("RESIZE_HISTORY retained text") }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 30)
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
        app.typeText("X")
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
