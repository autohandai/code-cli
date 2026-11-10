import AppKit
import XCTest

private struct NativeAccessibilityText {
    var label = ""
    var title = ""
    var value = ""

    var strings: [String] { [label, title, value] }
    var content: String { [value, label, title].first { !$0.isEmpty } ?? "" }
}

private struct NativeReadoutNode {
    var isTextView = false
    var text = NativeAccessibilityText()
    var children: [NativeReadoutNode] = []
}

private func nativeCodeTerminalBuffer<Snapshot>(_ capture: () throws -> Snapshot,
                                                children: (Snapshot) -> [Snapshot],
                                                textViewValue: (Snapshot) -> String?,
                                                maximumNodes: Int = 2_048) rethrows -> String {
    var pending = [try capture()]
    var visited = 0
    var values: [String] = []
    while let node = pending.popLast() {
        guard visited < maximumNodes else { return "" }
        visited += 1
        if let value = textViewValue(node) { values.append(value) }
        let descendants = children(node)
        guard descendants.count <= maximumNodes - visited - pending.count else { return "" }
        pending.append(contentsOf: descendants.reversed())
    }
    return values.filter { $0.contains("RESIZE_HISTORY retained text") }.max { $0.count < $1.count }
        ?? values.max { $0.count < $1.count } ?? ""
}

private struct NativeTerminalReadout {
    let read: () -> String?
    private(set) var frame: String?

    mutating func capture() -> Bool {
        frame = read()
        guard let value = frame else { return false }
        return value.contains("RESIZE_HISTORY retained text") && value.contains("preserved draft")
    }
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

private func nativeFixturePreparationFrames(current: CGRect, available: CGRect) -> [CGRect] {
    let target = nativeFixtureBaseline(current: current, available: available)
    let reduced = CGRect(origin: current.origin, size: CGSize(width: min(current.width, target.width), height: min(current.height, target.height)))
    return [reduced, CGRect(origin: target.origin, size: reduced.size), target]
}

private func nativeTerminalInputReady(terminal: String, textViewExists: Bool, splitTerminalEnabled: Bool) -> Bool {
    terminal == "vscode" ? splitTerminalEnabled : textViewExists
}

private func nativeReadoutUsesCopiedBuffer(terminal: String, accessibilityHasFixture: Bool, copiedBufferHasFixture: Bool) -> Bool {
    terminal == "vscode" && !accessibilityHasFixture && copiedBufferHasFixture
}

final class TerminalCompatibilityUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor func testIdleResize() throws { try resizeScenario(streaming: false) }
    @MainActor func testStreamingResize() throws { try resizeScenario(streaming: true) }

    func testNativeReadoutAssertsAgainstTheAcceptedFreshFrameWithoutCopyingAgain() {
        let raw = "Autohand Code\nRESIZE_HISTORY retained text\npreserved draft\nRESIZE_STREAM 308"
        var reads = 0
        var readout = NativeTerminalReadout(read: { reads += 1; return reads == 1 ? raw : nil })
        XCTAssertTrue(readout.capture())
        XCTAssertEqual(readout.frame, raw)
        XCTAssertEqual(reads, 1)
    }

    func testNativeReadoutUnavailableSamplesDoNotSelectOrCleanTheNextFreshFrame() {
        let raw = "Autohand Code\nRESIZE_HISTORY retained text\nRESIZE_HISTORY retained text\npreserved draft\nRESIZE_STREAM 309"
        var reads = 0
        var readout = NativeTerminalReadout(read: { reads += 1; return reads == 1 ? nil : raw })
        XCTAssertFalse(readout.capture())
        XCTAssertTrue(readout.capture())
        XCTAssertEqual(readout.frame, raw)
        XCTAssertEqual(readout.frame?.components(separatedBy: "RESIZE_HISTORY retained text").count, 3)
        XCTAssertEqual(reads, 2)
    }

    func testNativeReadoutCannotReuseAPreviousFrameWhenTheNextCopyIsUnavailable() {
        var reads = 0
        var readout = NativeTerminalReadout(read: {
            reads += 1
            return reads == 1 ? "RESIZE_HISTORY retained text\npreserved draft" : nil
        })
        XCTAssertTrue(readout.capture())
        XCTAssertFalse(readout.capture())
        XCTAssertNil(readout.frame)
    }

    func testNativeReadoutPermanentlyUnavailableSamplesFailTheReadinessDeadline() {
        var readout = NativeTerminalReadout(read: { nil })
        let ready = NSPredicate { _, _ in readout.capture() }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 0.01), .timedOut)
        XCTAssertNil(readout.frame)
    }

    func testNativeReadoutIgnoresAnnouncementsAndRowMirrorsWhenNoCompleteTextViewExists() {
        let announcement = "Autohand Code RESIZE_HISTORY retained text preserved draft"
        let root = NativeReadoutNode(children: [
            NativeReadoutNode(text: NativeAccessibilityText(value: announcement + announcement)),
            NativeReadoutNode(text: NativeAccessibilityText(value: "RESIZE_HISTORY retained text")),
            NativeReadoutNode(text: NativeAccessibilityText(value: "preserved draft"))
        ])
        let accessibility = nativeCodeTerminalBuffer({ root }, children: { $0.children },
            textViewValue: { $0.isTextView ? $0.text.value : nil })
        XCTAssertEqual(accessibility, "", "Announcements and individual rows are not a native terminal buffer")
        let copied = announcement + "\n" + announcement
        let useCopied = nativeReadoutUsesCopiedBuffer(terminal: "vscode",
            accessibilityHasFixture: accessibility.contains("RESIZE_HISTORY retained text"),
            copiedBufferHasFixture: copied.contains("RESIZE_HISTORY retained text"))
        XCTAssertTrue(useCopied)
        let content = useCopied ? copied : accessibility
        XCTAssertEqual(content, copied)
        XCTAssertEqual(content.components(separatedBy: "RESIZE_HISTORY retained text").count - 1, 2,
                       "A duplicated copied frame must still fail the native count assertion")
    }

    func testNativeReadoutCapturesOneSnapshotAndPreservesRawBufferDuplicates() {
        let buffer = "Autohand Code\nRESIZE_HISTORY retained text\nRESIZE_HISTORY retained text\npreserved draft\ntaXil"
        let root = NativeReadoutNode(children: [
            NativeReadoutNode(text: NativeAccessibilityText(value: buffer + buffer)),
            NativeReadoutNode(isTextView: true, text: NativeAccessibilityText(label: buffer, value: buffer)),
            NativeReadoutNode(text: NativeAccessibilityText(value: "RESIZE_HISTORY retained text"))
        ])
        var captures = 0
        let value = nativeCodeTerminalBuffer({ captures += 1; return root }, children: { $0.children },
            textViewValue: { $0.isTextView ? $0.text.value : nil })
        XCTAssertEqual(captures, 1)
        XCTAssertEqual(value, buffer)
        XCTAssertEqual(value.components(separatedBy: "RESIZE_HISTORY retained text").count - 1, 2)
    }

    func testNativeReadoutFailsClosedWhenTheSnapshotExceedsItsNodeBudget() {
        let root = NativeReadoutNode(children: [
            NativeReadoutNode(isTextView: true, text: NativeAccessibilityText(value: "Autohand Code RESIZE_HISTORY retained text")),
            NativeReadoutNode()
        ])
        XCTAssertEqual(nativeCodeTerminalBuffer({ root }, children: { $0.children },
            textViewValue: { $0.isTextView ? $0.text.value : nil }, maximumNodes: 2), "")
        XCTAssertEqual(nativeCodeTerminalBuffer({ root }, children: { $0.children },
            textViewValue: { $0.isTextView ? $0.text.value : nil }, maximumNodes: 3), "Autohand Code RESIZE_HISTORY retained text")
    }

    func testNativeViewportShrinksBeforeMovingAFullWidthWindow() {
        let display = CGRect(x: 0, y: 0, width: 1024, height: 768)
        let available = CGRect(x: 0, y: 31, width: 1024, height: 674)
        let frames = nativeFixturePreparationFrames(current: CGRect(x: 0, y: 31, width: 1024, height: 677), available: available)
        for frame in frames {
            XCTAssertTrue(display.contains(frame), "Every setup frame and resize corner must remain on-screen")
        }
        XCTAssertEqual(frames.last, nativeFixtureBaseline(current: CGRect(x: 0, y: 31, width: 1024, height: 677), available: available))
    }

    func testNativeInputReadinessUsesTheCodeTerminalInstanceInsteadOfATextViewRole() {
        XCTAssertTrue(nativeTerminalInputReady(terminal: "vscode", textViewExists: false, splitTerminalEnabled: true))
        XCTAssertFalse(nativeTerminalInputReady(terminal: "vscode", textViewExists: false, splitTerminalEnabled: false))
        XCTAssertFalse(nativeTerminalInputReady(terminal: "vscode", textViewExists: true, splitTerminalEnabled: false))
        XCTAssertFalse(nativeTerminalInputReady(terminal: "iterm2", textViewExists: false, splitTerminalEnabled: true))
        XCTAssertTrue(nativeTerminalInputReady(terminal: "iterm2", textViewExists: true, splitTerminalEnabled: false))
    }

    func testNativeInputReadoutRequiresTheActualFixtureBeforeUsingTheCopiedBuffer() {
        XCTAssertTrue(nativeReadoutUsesCopiedBuffer(terminal: "vscode", accessibilityHasFixture: false, copiedBufferHasFixture: true))
        XCTAssertFalse(nativeReadoutUsesCopiedBuffer(terminal: "vscode", accessibilityHasFixture: false, copiedBufferHasFixture: false))
        XCTAssertFalse(nativeReadoutUsesCopiedBuffer(terminal: "vscode", accessibilityHasFixture: true, copiedBufferHasFixture: true))
        XCTAssertFalse(nativeReadoutUsesCopiedBuffer(terminal: "iterm2", accessibilityHasFixture: false, copiedBufferHasFixture: true))
    }

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
            let split = app.menuBars.menuItems.matching(NSPredicate(format: "title == %@", "Split Terminal")).firstMatch
            return nativeTerminalInputReady(terminal: terminal, textViewExists: terminal != "vscode" && terminalView.exists,
                                            splitTerminalEnabled: terminal == "vscode" && split.exists && split.isEnabled)
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: terminalReady, object: app)], timeout: 20) == .completed else {
            attachStartupFailure(app, terminal: terminal, phase: "terminal-view")
            XCTFail("The native terminal did not expose a ready input target")
            return
        }
        if terminal != "vscode" { terminalView.click() }
        NSPasteboard.general.clearContents()
        XCTAssertTrue(NSPasteboard.general.writeObjects([command as NSString]))
        app.typeKey("v", modifierFlags: .command)
        app.typeKey(.return, modifierFlags: [])
        var startupValue = ""
        var accessibilityStartup = ""
        var copiedStartup = ""
        var useCopiedBuffer = false
        let ready = NSPredicate { _, _ in
            accessibilityStartup = self.terminalValue(window) ?? ""
            startupValue = accessibilityStartup
            if !startupValue.contains("RESIZE_HISTORY retained text"), terminal == "vscode" {
                copiedStartup = self.copiedTerminalValue(window) ?? ""
                accessibilityStartup = self.terminalValue(window) ?? ""
                useCopiedBuffer = nativeReadoutUsesCopiedBuffer(terminal: terminal,
                    accessibilityHasFixture: accessibilityStartup.contains("RESIZE_HISTORY retained text"),
                    copiedBufferHasFixture: copiedStartup.contains("RESIZE_HISTORY retained text"))
                startupValue = useCopiedBuffer ? copiedStartup : accessibilityStartup
            }
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
        if terminal == "vscode" {
            print("NATIVE_TERMINAL_READOUT vscode \(useCopiedBuffer ? "native-copy" : "accessibility")")
            let evidence = XCTAttachment(string: "Readout: \(useCopiedBuffer ? "native-copy" : "accessibility")\nAccessibility:\n"
                + String(accessibilityStartup.prefix(7_900)) + "\nCopied buffer:\n" + String(copiedStartup.prefix(7_900)))
            evidence.name = "vscode-\(streaming ? "streaming" : "idle")-readout-preflight"
            evidence.lifetime = .keepAlways
            add(evidence)
        }
        for (index, delta) in nativeResizeDeltas.enumerated() {
            let frame = window.frame
            let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
            corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(delta))
            XCTAssertNotEqual(window.frame.size, frame.size, "The native window did not resize")
            XCTAssertTrue(displayBounds.contains(window.frame), "The resized fixture window left the display bounds")
            var readout = NativeTerminalReadout(read: { self.terminalValue(window, useCopiedBuffer: useCopiedBuffer) })
            let settled = NSPredicate { _, _ in readout.capture() }
            guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: window)], timeout: 10) == .completed,
                  let content = readout.frame else {
                let content = XCTAttachment(string: String((readout.frame ?? "No fresh terminal buffer was available").suffix(16_000)))
                content.name = "\(terminal)-resize-\(index)-terminal"
                content.lifetime = .keepAlways
                add(content)
                attachStartupFailure(app, terminal: terminal, phase: "resize-\(index)")
                XCTFail("The resized native window did not retain its history and draft")
                return
            }
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
        let edited = NSPredicate { _, _ in self.terminalValue(window, useCopiedBuffer: useCopiedBuffer)?.contains("taXil") == true }
        expectation(for: edited, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        let exit = NSPredicate { _, _ in app.state == .notRunning || self.terminalValue(window, useCopiedBuffer: useCopiedBuffer)?.contains("RESIZE_PTY_EXIT") == true }
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
        for step in nativeFixturePreparationFrames(current: window.frame, available: available) {
            let frame = window.frame
            if abs(step.minX - frame.minX) > 0.5 || abs(step.minY - frame.minY) > 0.5 {
                let grip = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: terminal == "vscode" ? 110 : frame.width * 0.75, dy: 12))
                grip.press(forDuration: 0.1, thenDragTo: grip.withOffset(CGVector(dx: step.minX - frame.minX, dy: step.minY - frame.minY)))
            }
            let moved = window.frame
            if abs(step.width - moved.width) > 0.5 || abs(step.height - moved.height) > 0.5 {
                let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
                corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: step.width - moved.width, dy: step.height - moved.height)))
            }
            print("NATIVE_TERMINAL_PREPARE \(terminal) \(window.frame) target=\(step) display=\(bounds)")
            XCTAssertTrue(bounds.contains(window.frame), "Every fixture setup gesture must stay within the display")
        }
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
        let description = app.debugDescription
        let bounded = description.count > 16_000 ? String(description.prefix(8_000)) + "\n…\n" + String(description.suffix(7_997)) : description
        let hierarchy = XCTAttachment(string: bounded)
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

    private func copiedTerminalValue(_ window: XCUIElement) -> String? {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        let generation = pasteboard.changeCount
        window.typeKey("y", modifierFlags: [.control, .shift])
        let written = NSPredicate { _, _ in pasteboard.changeCount > generation && pasteboard.string(forType: .string) != nil }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: written, object: pasteboard)], timeout: 2) == .completed,
              pasteboard.changeCount > generation, let value = pasteboard.string(forType: .string) else {
            print("NATIVE_TERMINAL_COPY_UNAVAILABLE baseline=\(generation) observed=\(pasteboard.changeCount)")
            return nil
        }
        return value
    }

    private func terminalValue(_ window: XCUIElement, useCopiedBuffer: Bool = false) -> String? {
        if useCopiedBuffer { return copiedTerminalValue(window) }
        if environment["AUTOHAND_NATIVE_TERMINAL"] == "vscode" {
            return (try? nativeCodeTerminalBuffer({ try window.snapshot() }, children: { $0.children },
                textViewValue: { $0.elementType == .textView ? $0.value as? String : nil })) ?? ""
        }
        let values = window.textViews.allElementsBoundByIndex.compactMap { $0.value as? String }
        if let terminal = values.filter({ $0.contains("RESIZE_HISTORY retained text") }).max(by: { $0.count < $1.count }) {
            return terminal
        }
        return values.max(by: { $0.count < $1.count }) ?? ""
    }
}
