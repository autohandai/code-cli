import AppKit
import XCTest

private struct NativeAccessibilityText {
    var label = ""
    var title = ""
    var value = ""

    var strings: [String] { [label, title, value] }
}

private struct NativeWindowFrame: Equatable {
    let processIdentifier: Int32
    let windowIdentifier: UInt32
    let frame: CGRect
}

private func nativeFixtureWindow(_ windows: [NativeWindowFrame], identity: NativeWindowFrame) -> NativeWindowFrame? {
    let owned = windows.filter { $0.processIdentifier == identity.processIdentifier }
    guard owned.count == 1, owned[0].windowIdentifier == identity.windowIdentifier else { return nil }
    return owned[0]
}

private func nativeFixtureWindowReference<Window>(_ retained: Window, refresh: (() -> Window?)?) -> Window? {
    if let refresh { return refresh() }
    return retained
}

private func nativeFixtureMoveFrame(current: CGRect, target: CGRect, bounds: CGRect) -> CGRect? {
    let proposed = CGRect(origin: target.origin, size: current.size)
    return bounds.contains(proposed) ? proposed : nil
}

private func nativeCopiedTerminalBuffer(baseline: Int, observed: Int, value: String?) -> String? {
    guard observed > baseline else { return nil }
    return value
}

private struct NativeTerminalReadout {
    let read: () -> String?
    let requiresStreaming: Bool
    private(set) var frame: String?

    init(read: @escaping () -> String?, requiresStreaming: Bool = false) {
        self.read = read
        self.requiresStreaming = requiresStreaming
    }

    mutating func capture() -> Bool {
        frame = read()
        guard let value = frame else { return false }
        return value.contains("Autohand Code") && value.contains("RESIZE_HISTORY retained text")
            && value.contains("preserved draft") && (!requiresStreaming || value.contains("RESIZE_STREAM "))
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

final class TerminalCompatibilityUITests: XCTestCase {
    private var environment: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor func testIdleResize() throws { try resizeScenario(streaming: false) }
    @MainActor func testStreamingResize() throws { try resizeScenario(streaming: true) }

    func testNativeViewportDoesNotMoveAWindowWhoseWidthIgnoredTheShrink() {
        let bounds = CGRect(x: 0, y: 0, width: 1024, height: 768)
        let target = CGRect(x: 20, y: 33, width: 904, height: 610)
        XCTAssertNil(nativeFixtureMoveFrame(current: CGRect(x: 0, y: 31, width: 1024, height: 610), target: target, bounds: bounds))
        XCTAssertEqual(nativeFixtureMoveFrame(current: CGRect(x: 0, y: 31, width: 904, height: 610), target: target, bounds: bounds), target)
    }

    func testNativeViewportRefreshesSetupGeometryAndDoesNotReuseAStaleReferenceOnFailure() {
        let retained = NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 101, frame: CGRect(x: 0, y: 31, width: 1024, height: 610))
        let current = NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 101, frame: CGRect(x: 0, y: 31, width: 904, height: 610))
        let refreshed = nativeFixtureWindowReference(retained, refresh: { nativeFixtureWindow([current], identity: retained) })
        XCTAssertEqual(refreshed?.frame.width, 904)
        let replaced = NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 102, frame: current.frame)
        XCTAssertNil(nativeFixtureWindowReference(retained, refresh: { nativeFixtureWindow([replaced], identity: retained) }))
        XCTAssertEqual(nativeFixtureWindowReference(retained, refresh: nil), retained)
    }

    func testNativeViewportKeepsTheNativeWindowIdentityWhileAccessibilityNodesChange() {
        let identity = NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 101, frame: CGRect(x: 0, y: 31, width: 904, height: 610))
        let resized = NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 101, frame: CGRect(x: 20, y: 33, width: 784, height: 550))
        XCTAssertEqual(nativeFixtureWindow([resized], identity: identity), resized)
        XCTAssertNil(nativeFixtureWindow([NativeWindowFrame(processIdentifier: 6736, windowIdentifier: 102, frame: resized.frame)], identity: identity))
        XCTAssertNil(nativeFixtureWindow([resized, identity], identity: identity))
        XCTAssertNil(nativeFixtureWindow([NativeWindowFrame(processIdentifier: 6737, windowIdentifier: 101, frame: resized.frame)], identity: identity))
    }

    func testNativeReadoutRejectsStaleClipboardValuesEvenWhenAllMarkersArePresent() {
        let stale = "Autohand Code\nRESIZE_HISTORY retained text\npreserved draft\nRESIZE_STREAM 313"
        XCTAssertNil(nativeCopiedTerminalBuffer(baseline: 18, observed: 18, value: stale))
        XCTAssertNil(nativeCopiedTerminalBuffer(baseline: 18, observed: 17, value: stale))
        XCTAssertNil(nativeCopiedTerminalBuffer(baseline: 18, observed: 19, value: nil))
    }

    func testNativeReadoutPreservesEveryByteAndDuplicateInAFreshNativeCopy() {
        let raw = "Autohand Code\r\nRESIZE_HISTORY retained text\n\nRESIZE_HISTORY retained text\n  preserved draft  \nRESIZE_STREAM 382\n"
        let fresh = nativeCopiedTerminalBuffer(baseline: 18, observed: 19, value: raw)
        XCTAssertEqual(fresh, raw)
        XCTAssertEqual(fresh.map { Array($0.utf8) }, Array(raw.utf8))
        XCTAssertEqual(fresh?.components(separatedBy: "RESIZE_HISTORY retained text").count, 3)
        var readout = NativeTerminalReadout(read: { fresh }, requiresStreaming: true)
        XCTAssertTrue(readout.capture())
        XCTAssertEqual(readout.frame, raw)
    }

    func testNativeReadoutWaitsForTheHeaderBeforeAcceptingACompleteFrame() {
        let partial = "RESIZE_HISTORY retained text\npreserved draft\nRESIZE_STREAM 293"
        let complete = "Autohand Code\n" + partial
        var reads = 0
        var readout = NativeTerminalReadout(read: { reads += 1; return reads == 1 ? partial : complete }, requiresStreaming: true)
        XCTAssertFalse(readout.capture())
        XCTAssertTrue(readout.capture())
        XCTAssertEqual(readout.frame, complete)
        XCTAssertEqual(reads, 2)
        var duplicate = NativeTerminalReadout(read: { "Autohand Code\n" + complete }, requiresStreaming: true)
        XCTAssertTrue(duplicate.capture())
        XCTAssertEqual(duplicate.frame?.components(separatedBy: "Autohand Code").count, 3,
                       "Presence readiness must leave duplicate headers for the exact-count assertion")
    }

    func testNativeReadoutPermanentlyMissingHeaderFailsTheUnchangedReadinessDeadline() {
        var readout = NativeTerminalReadout(read: { "RESIZE_HISTORY retained text\npreserved draft" })
        XCTAssertFalse(readout.capture())
        let ready = NSPredicate { _, _ in readout.capture() }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 0.01), .timedOut)
    }

    func testNativeReadoutRequiresTheStreamMarkerOnlyForStreamingScenarios() {
        var value = "Autohand Code\nRESIZE_HISTORY retained text\npreserved draft"
        var idle = NativeTerminalReadout(read: { value })
        XCTAssertTrue(idle.capture())
        var streaming = NativeTerminalReadout(read: { value }, requiresStreaming: true)
        XCTAssertFalse(streaming.capture())
        value += "\nRESIZE_STREAM 341"
        XCTAssertTrue(streaming.capture())
        XCTAssertEqual(streaming.frame, value)
    }

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
            return reads == 1 ? "Autohand Code\nRESIZE_HISTORY retained text\npreserved draft" : nil
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
        var launchedProcessIdentifier: Int32?
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: application), configuration: configuration) { running, error in
            launchedProcessIdentifier = running?.processIdentifier
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
        let initialBounds = terminal == "vscode" ? nil : normalizeViewport(window, terminal: terminal)
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
        let nativeIdentity: NativeWindowFrame?
        if terminal == "vscode" {
            guard let processIdentifier = launchedProcessIdentifier else {
                XCTFail("macOS did not identify the launched VS Code process")
                return
            }
            let native = visibleNativeWindows(processIdentifier: processIdentifier)
            guard native.count == 1, native[0].frame == window.frame else {
                XCTFail("VS Code must have one identifiable native fixture window")
                return
            }
            nativeIdentity = native[0]
            print("NATIVE_TERMINAL_WINDOW vscode pid=\(native[0].processIdentifier) id=\(native[0].windowIdentifier)")
        } else { nativeIdentity = nil }
        let displayBounds = initialBounds ?? normalizeViewport(window, terminal: terminal, verifyWindow: {
            guard let identity = nativeIdentity else { return false }
            return nativeFixtureWindow(self.visibleNativeWindows(processIdentifier: identity.processIdentifier), identity: identity) != nil
        }, refreshWindow: {
            guard let identity = nativeIdentity else { return nil }
            return self.currentCodeWindow(app, identity: identity)
        })
        let readTerminal: () -> String? = {
            if let identity = nativeIdentity { return self.codeTerminalValue(app, identity: identity) }
            return self.terminalValue(window)
        }
        if terminal != "vscode" { terminalView.click() }
        NSPasteboard.general.clearContents()
        XCTAssertTrue(NSPasteboard.general.writeObjects([command as NSString]))
        app.typeKey("v", modifierFlags: .command)
        app.typeKey(.return, modifierFlags: [])
        var startupValue = ""
        let ready = NSPredicate { _, _ in
            startupValue = readTerminal() ?? ""
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
            print("NATIVE_TERMINAL_READOUT vscode native-copy")
            let evidence = XCTAttachment(string: "Readout: native-copy\nCopied buffer:\n" + String(startupValue.prefix(16_000)))
            evidence.name = "vscode-\(streaming ? "streaming" : "idle")-readout-preflight"
            evidence.lifetime = .keepAlways
            add(evidence)
        }
        for (index, delta) in nativeResizeDeltas.enumerated() {
            if let identity = nativeIdentity {
                guard let current = currentCodeWindow(app, identity: identity) else { return }
                window = current
            }
            let frame = window.frame
            let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
            corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(delta))
            if let identity = nativeIdentity {
                guard let current = currentCodeWindow(app, identity: identity) else { return }
                window = current
            }
            XCTAssertNotEqual(window.frame.size, frame.size, "The native window did not resize")
            XCTAssertTrue(displayBounds.contains(window.frame), "The resized fixture window left the display bounds")
            var readout = NativeTerminalReadout(read: { readTerminal() }, requiresStreaming: streaming)
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
        let edited = NSPredicate { _, _ in readTerminal()?.contains("taXil") == true }
        expectation(for: edited, evaluatedWith: app)
        waitForExpectations(timeout: 10)
        app.typeKey(.escape, modifierFlags: [])
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        app.typeKey("c", modifierFlags: .control)
        let exit = NSPredicate { _, _ in app.state == .notRunning || readTerminal()?.contains("RESIZE_PTY_EXIT") == true }
        expectation(for: exit, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        print(streaming ? "NATIVE_TERMINAL_STREAMING_PASS" : "NATIVE_TERMINAL_IDLE_PASS")
    }

    @MainActor
    private func normalizeViewport(_ retainedWindow: XCUIElement, terminal: String, verifyWindow: () -> Bool = { true },
                                   refreshWindow: (() -> XCUIElement?)? = nil) -> CGRect {
        guard var window = nativeFixtureWindowReference(retainedWindow, refresh: refreshWindow) else { return .zero }
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
            guard let current = nativeFixtureWindowReference(window, refresh: refreshWindow) else { return bounds }
            window = current
            XCTAssertTrue(verifyWindow(), "The native fixture window identity changed before setup")
            let frame = window.frame
            if abs(step.minX - frame.minX) > 0.5 || abs(step.minY - frame.minY) > 0.5 {
                guard nativeFixtureMoveFrame(current: frame, target: step, bounds: bounds) != nil else {
                    XCTFail("The native window did not shrink enough for an on-screen move")
                    return bounds
                }
                let grip = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: terminal == "vscode" ? 110 : frame.width * 0.75, dy: 12))
                grip.press(forDuration: 0.1, thenDragTo: grip.withOffset(CGVector(dx: step.minX - frame.minX, dy: step.minY - frame.minY)))
                guard let current = nativeFixtureWindowReference(window, refresh: refreshWindow) else { return bounds }
                window = current
            }
            let moved = window.frame
            if abs(step.width - moved.width) > 0.5 || abs(step.height - moved.height) > 0.5 {
                let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
                corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: step.width - moved.width, dy: step.height - moved.height)))
                guard let current = nativeFixtureWindowReference(window, refresh: refreshWindow) else { return bounds }
                window = current
            }
            print("NATIVE_TERMINAL_PREPARE \(terminal) \(window.frame) target=\(step) display=\(bounds)")
            XCTAssertTrue(verifyWindow(), "The native fixture window identity changed during setup")
            if terminal == "vscode" {
                XCTAssertEqual(window.frame.width, step.width, accuracy: 1, "The native window did not accept the requested width")
                XCTAssertEqual(window.frame.height, step.height, accuracy: 1, "The native window did not accept the requested height")
            }
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

    private func visibleNativeWindows(processIdentifier: Int32) -> [NativeWindowFrame] {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        return windows.compactMap { window in
            guard let pid = window[kCGWindowOwnerPID as String] as? NSNumber, pid.int32Value == processIdentifier,
                  let layer = window[kCGWindowLayer as String] as? NSNumber, layer.intValue == 0,
                  let identifier = window[kCGWindowNumber as String] as? NSNumber,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds) else { return nil }
            return NativeWindowFrame(processIdentifier: pid.int32Value, windowIdentifier: identifier.uint32Value, frame: frame)
        }
    }

    private func currentCodeWindow(_ app: XCUIApplication, identity: NativeWindowFrame) -> XCUIElement? {
        guard let native = nativeFixtureWindow(visibleNativeWindows(processIdentifier: identity.processIdentifier), identity: identity) else {
            XCTFail("VS Code changed the fixture's native window ID, process, or window count")
            return nil
        }
        let windows = app.windows.allElementsBoundByAccessibilityElement.filter { $0.frame == native.frame }
        guard windows.count == 1 else {
            XCTFail("VS Code did not expose exactly one accessibility window for the native fixture frame")
            return nil
        }
        return windows[0]
    }

    private func codeTerminalValue(_ app: XCUIApplication, identity: NativeWindowFrame) -> String? {
        guard let native = nativeFixtureWindow(visibleNativeWindows(processIdentifier: identity.processIdentifier), identity: identity) else {
            XCTFail("VS Code changed the fixture's native window ID, process, or window count")
            return nil
        }
        let value = copiedTerminalValue(app)
        guard nativeFixtureWindow(visibleNativeWindows(processIdentifier: identity.processIdentifier), identity: identity) == native else { return nil }
        return value
    }

    private func copiedTerminalValue(_ window: XCUIElement) -> String? {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        let generation = pasteboard.changeCount
        window.typeKey("y", modifierFlags: [.control, .shift])
        let written = NSPredicate { _, _ in
            nativeCopiedTerminalBuffer(baseline: generation, observed: pasteboard.changeCount,
                                       value: pasteboard.string(forType: .string)) != nil
        }
        guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: written, object: pasteboard)], timeout: 2) == .completed,
              let value = nativeCopiedTerminalBuffer(baseline: generation, observed: pasteboard.changeCount,
                                                    value: pasteboard.string(forType: .string)) else {
            print("NATIVE_TERMINAL_COPY_UNAVAILABLE baseline=\(generation) observed=\(pasteboard.changeCount)")
            return nil
        }
        print("NATIVE_TERMINAL_COPY_FRESH baseline=\(generation) observed=\(pasteboard.changeCount) bytes=\(value.utf8.count)")
        return value
    }

    private func terminalValue(_ window: XCUIElement) -> String? {
        let values = window.textViews.allElementsBoundByIndex.compactMap { $0.value as? String }
        if let terminal = values.filter({ $0.contains("RESIZE_HISTORY retained text") }).max(by: { $0.count < $1.count }) {
            return terminal
        }
        return values.max(by: { $0.count < $1.count }) ?? ""
    }
}
