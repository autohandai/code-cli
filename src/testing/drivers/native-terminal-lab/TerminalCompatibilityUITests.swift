import AppKit
import XCTest

private struct NativeAccessibilityText {
    var label = ""
    var title = ""
    var value = ""

    var strings: [String] { [label, title, value] }
    var content: String { [value, label, title].first { !$0.isEmpty } ?? "" }
}

private func localNetworkDenialButton(dialog: [NativeAccessibilityText], buttons: [NativeAccessibilityText]) -> Int? {
    let text = dialog.flatMap(\.strings).joined(separator: " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard text.contains("find devices on local networks") else { return nil }
    return buttons.firstIndex { text in
        text.strings.contains { $0.replacingOccurrences(of: "’", with: "'") == "Don't Allow" }
    }
}

private let nativeResizeDeltas = [CGVector(dx: -160, dy: -100), CGVector(dx: 240, dy: 160),
                                  CGVector(dx: -200, dy: -120), CGVector(dx: 160, dy: 100)]

private func nativeFixtureBaseline(current: CGRect, available: CGRect) -> CGRect {
    var growth = CGSize.zero
    var maximumGrowth = CGSize.zero
    for delta in nativeResizeDeltas {
        growth.width += delta.dx
        growth.height += delta.dy
        maximumGrowth.width = max(maximumGrowth.width, growth.width)
        maximumGrowth.height = max(maximumGrowth.height, growth.height)
    }
    return CGRect(x: available.minX + 20, y: available.minY + 2,
                  width: min(current.width, available.width - maximumGrowth.width - 40),
                  height: available.height - maximumGrowth.height - 4)
}

final class TerminalCompatibilityUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor func testIdleResize() throws { try resizeScenario(streaming: false) }
    @MainActor func testStreamingResize() throws { try resizeScenario(streaming: true) }

    func testNativeViewportKeepsAllFourResizesWithinTheDisplayAndLargeEnoughForHistory() {
        let available = CGRect(x: 0, y: 31, width: 1024, height: 677)
        var frame = nativeFixtureBaseline(current: CGRect(x: 400, y: 246, width: 587, height: 462), available: available)
        for delta in nativeResizeDeltas {
            frame.size.width += delta.dx
            frame.size.height += delta.dy
            XCTAssertTrue(available.contains(frame))
            XCTAssertGreaterThanOrEqual(frame.width, 400)
            XCTAssertGreaterThanOrEqual(frame.height, 500)
        }
    }

    func testLocalNetworkPermissionUsesStaticTextValueAndButtonTitle() {
        let dialog = [NativeAccessibilityText(value: "Allow “iTerm” to find devices on local networks?")]
        XCTAssertEqual(localNetworkDenialButton(dialog: dialog, buttons: [
            NativeAccessibilityText(label: "action-button-1", title: "Allow"),
            NativeAccessibilityText(label: "action-button-2", title: "Don’t Allow")
        ]), 1)
    }

    func testLocalNetworkPermissionPreservesLabelBasedAccessibility() {
        XCTAssertEqual(localNetworkDenialButton(dialog: [
            NativeAccessibilityText(label: "Allow “iTerm” to find devices on local networks?")
        ], buttons: [NativeAccessibilityText(label: "Don't Allow")]), 0)
    }

    func testLocalNetworkPermissionRecognizesWrappedValues() {
        XCTAssertEqual(localNetworkDenialButton(dialog: [
            NativeAccessibilityText(value: "Allow “iTerm” to find devices on\nlocal networks?")
        ], buttons: [NativeAccessibilityText(value: "Don’t Allow")]), 0)
    }

    func testLocalNetworkPermissionDoesNotDismissOtherAlertsOrGrantAccess() {
        XCTAssertNil(localNetworkDenialButton(dialog: [NativeAccessibilityText(value: "Allow notifications?")],
                                             buttons: [NativeAccessibilityText(title: "Don't Allow")]))
        XCTAssertNil(localNetworkDenialButton(dialog: [NativeAccessibilityText(value: "find devices on local networks")],
                                             buttons: [NativeAccessibilityText(title: "Allow")]))
    }

    func testAccessibilityContentDoesNotDuplicateMirroredAttributes() {
        XCTAssertEqual(NativeAccessibilityText(label: "RESIZE_HISTORY retained text", title: "RESIZE_HISTORY retained text",
                                              value: "RESIZE_HISTORY retained text").content, "RESIZE_HISTORY retained text")
    }

    @MainActor
    private func resizeScenario(streaming: Bool) throws {
        guard environment["GITHUB_ACTIONS"] == "true",
              let terminal = environment["AUTOHAND_NATIVE_TERMINAL"],
              let application = environment["AUTOHAND_NATIVE_APPLICATION"],
              let fixture = environment["AUTOHAND_NATIVE_FIXTURE"],
              let arguments = environment["AUTOHAND_NATIVE_LAUNCH_ARGUMENTS"]?.data(using: .utf8) else {
            XCTFail("This scenario requires an isolated GitHub Actions macOS runner")
            return
        }
        continueAfterFailure = false
        let interruption = addUIInterruptionMonitor(withDescription: "Deny local network access for the offline terminal fixture") { alert in
            let buttons = alert.buttons.allElementsBoundByIndex
            let text = ([alert] + alert.staticTexts.allElementsBoundByIndex).map(self.accessibilityText)
            guard let denied = localNetworkDenialButton(dialog: text, buttons: buttons.map(self.accessibilityText)) else { return false }
            buttons[denied].click()
            print("NATIVE_TERMINAL_DENIED_LOCAL_NETWORK")
            return true
        }
        addTeardownBlock { self.removeUIInterruptionMonitor(interruption) }
        let app = XCUIApplication(url: URL(fileURLWithPath: application))
        addTeardownBlock { if app.state != .notRunning { app.terminate() } }
        let command = "'" + fixture.replacingOccurrences(of: "'", with: "'\\''") + "'" + (streaming ? " --streaming" : "")
        let modes = try JSONDecoder().decode([String: [String]].self, from: arguments)
        guard let launchArguments = modes[streaming ? "streaming" : "idle"] else {
            XCTFail("Missing isolated launch arguments for the native scenario")
            return
        }
        app.launchArguments = launchArguments
        if let profileIndex = launchArguments.firstIndex(of: "--user-data-dir"), profileIndex + 1 < launchArguments.count {
            let profile = launchArguments[profileIndex + 1]
            addTeardownBlock { self.attachApplicationLogs(profile: profile) }
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
        var window = app.windows.firstMatch
        guard window.waitForExistence(timeout: 30) else {
            attachStartupFailure(app, terminal: terminal, phase: "window")
            XCTFail("The native terminal did not create a window")
            return
        }
        if terminal == "iterm2" {
            window.click()
            let previousWindowCount = app.windows.count
            app.typeKey("n", modifierFlags: .command)
            let newWindow = NSPredicate { _, _ in app.windows.count > previousWindowCount }
            guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: newWindow, object: app)], timeout: 10) == .completed else {
                attachStartupFailure(app, terminal: terminal, phase: "fresh-window")
                XCTFail("iTerm2 did not create a fresh terminal window")
                return
            }
            window = app.windows.firstMatch
        }
        guard let fixtureWindow = app.windows.allElementsBoundByAccessibilityElement.first else {
            XCTFail("The native fixture window disappeared before viewport setup")
            return
        }
        window = fixtureWindow
        let displayBounds = normalizeViewport(window, terminal: terminal)
        if terminal == "vscode" {
            guard app.menuBars.menuBarItems["Terminal"].waitForExistence(timeout: 30) else {
                attachStartupFailure(app, terminal: terminal, phase: "workbench")
                XCTFail("VS Code did not display its workbench")
                return
            }
            dismissCopilotSignIn(app)
            openVSCodeTerminal(app)
        }
        let terminalView = window.textViews.firstMatch
        let terminalReady = NSPredicate { _, _ in
            if terminal == "vscode", self.dismissCopilotSignIn(app) {
                self.openVSCodeTerminal(app)
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
            startupValue = self.terminalValue(window)
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
        for (index, delta) in nativeResizeDeltas.enumerated() {
            let frame = window.frame
            let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
            corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(delta))
            XCTAssertNotEqual(window.frame.size, frame.size, "The native window did not resize")
            XCTAssertTrue(displayBounds.contains(window.frame), "The resized fixture window left the display bounds")
            let settled = NSPredicate { _, _ in
                let value = self.terminalValue(window)
                return value.contains("RESIZE_HISTORY retained text") && value.contains("preserved draft")
            }
            guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: window)], timeout: 10) == .completed else {
                let content = XCTAttachment(string: String(terminalValue(window).suffix(16_000)))
                content.name = "\(terminal)-resize-\(index)-terminal"
                content.lifetime = .keepAlways
                add(content)
                attachStartupFailure(app, terminal: terminal, phase: "resize-\(index)")
                XCTFail("The resized native window did not retain its history and draft")
                return
            }
            let content = terminalValue(window)
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
        let edited = NSPredicate { _, _ in self.terminalValue(window).contains("taXil") }
        expectation(for: edited, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        let exit = NSPredicate { _, _ in self.terminalValue(window).contains("RESIZE_PTY_EXIT") || app.state == .notRunning }
        expectation(for: exit, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        print(streaming ? "NATIVE_TERMINAL_STREAMING_PASS" : "NATIVE_TERMINAL_IDLE_PASS")
    }

    @MainActor
    private func normalizeViewport(_ window: XCUIElement, terminal: String) -> CGRect {
        guard let screen = NSScreen.main else {
            XCTFail("The native terminal runner has no display")
            return .zero
        }
        let desktopTop = NSScreen.screens.first?.frame.maxY ?? screen.frame.maxY
        let bounds = CGRect(x: screen.frame.minX, y: desktopTop - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
        let visible = screen.visibleFrame
        let available = CGRect(x: visible.minX, y: desktopTop - visible.maxY, width: visible.width, height: visible.height)
        let target = nativeFixtureBaseline(current: window.frame, available: available)
        let frame = window.frame
        let grip = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: terminal == "vscode" ? 110 : frame.width * 0.75, dy: 12))
        grip.press(forDuration: 0.1, thenDragTo: grip.withOffset(CGVector(dx: target.minX - frame.minX, dy: target.minY - frame.minY)))
        let moved = window.frame
        let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
        corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: target.width - moved.width, dy: target.height - moved.height)))
        XCTAssertGreaterThanOrEqual(window.frame.height, target.height - 20, "The native fixture needs room for both transcript exchanges")
        XCTAssertTrue(bounds.contains(window.frame), "The fixture viewport must stay within the display")
        print("NATIVE_TERMINAL_VIEWPORT \(terminal) \(window.frame) display=\(available)")
        return bounds
    }

    private func attachApplicationLogs(profile: String) {
        let logs = URL(fileURLWithPath: profile).appendingPathComponent("logs")
        guard let files = FileManager.default.enumerator(at: logs, includingPropertiesForKeys: nil) else { return }
        var count = 0
        for case let file as URL in files where file.lastPathComponent == "main.log" && count < 4 {
            guard let handle = try? FileHandle(forReadingFrom: file) else { continue }
            defer { try? handle.close() }
            guard let end = try? handle.seekToEnd(), (try? handle.seek(toOffset: end > 16_000 ? end - 16_000 : 0)) != nil,
                  let data = try? handle.read(upToCount: 16_000) else { continue }
            let log = XCTAttachment(string: String(decoding: data, as: UTF8.self))
            log.name = "vscode-\(URL(fileURLWithPath: profile).lastPathComponent)-main-log-\(count)"
            log.lifetime = .keepAlways
            add(log)
            count += 1
        }
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

    private func openVSCodeTerminal(_ app: XCUIApplication) {
        app.menuBars.menuBarItems["Terminal"].click()
        let command = app.menuBars.menuItems["New Terminal"]
        XCTAssertTrue(command.waitForExistence(timeout: 10), "VS Code did not expose Terminal > New Terminal")
        XCTAssertTrue(command.isEnabled, "VS Code disabled Terminal > New Terminal")
        command.click()
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

    private func accessibilityText(_ element: XCUIElement) -> NativeAccessibilityText {
        NativeAccessibilityText(label: element.label, title: element.title, value: element.value as? String ?? "")
    }

    private func terminalValue(_ window: XCUIElement) -> String {
        let values = window.textViews.allElementsBoundByIndex.compactMap { $0.value as? String }
        if let terminal = values.filter({ $0.contains("RESIZE_HISTORY retained text") }).max(by: { $0.count < $1.count }) {
            return terminal
        }
        if environment["AUTOHAND_NATIVE_TERMINAL"] == "vscode" {
            return window.staticTexts.allElementsBoundByIndex.map { accessibilityText($0).content }.joined(separator: "\n")
        }
        return values.max(by: { $0.count < $1.count }) ?? ""
    }
}
