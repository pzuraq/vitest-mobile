import Foundation
import UIKit

// Replacement for Hammer's XCTest-based waiting that works in app targets.
// Uses RunLoop instead of XCTestExpectation.

extension EventGenerator {
    /// Object to handle waiting
    public final class Waiter {
        public enum State {
            case idle
            case running
            case completed(timeout: Bool)
        }

        public let timeout: TimeInterval
        public private(set) var state: State = .idle
        private var isComplete = false

        public init(timeout: TimeInterval) {
            self.timeout = timeout
        }

        public func start(throwIfAlreadyCompleted: Bool = true) throws {
            if case .running = self.state {
                throw HammerError.waiterIsAlreadyRunning
            } else if case .completed = self.state {
                if throwIfAlreadyCompleted {
                    throw HammerError.waiterIsAlreadyCompleted
                } else {
                    return
                }
            }

            self.state = .running
            let deadline = Date().addingTimeInterval(self.timeout)
            while !self.isComplete && Date() < deadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
            }

            if self.isComplete {
                self.state = .completed(timeout: false)
            } else {
                self.state = .completed(timeout: true)
            }
        }

        public func complete() throws {
            if case .idle = self.state {
                throw HammerError.waiterIsNotRunning
            } else if case .completed = self.state {
                throw HammerError.waiterIsAlreadyCompleted
            }

            self.isComplete = true
        }
    }

    public func wait(_ interval: TimeInterval) throws {
        try Waiter(timeout: interval).start()
    }

    public func waitUntil(_ condition: @escaping (Waiter) throws -> Void, timeout: TimeInterval) throws {
        let waiter = Waiter(timeout: timeout)
        try condition(waiter)
        try waiter.start(throwIfAlreadyCompleted: false)
    }

    public func waitUntil(_ condition: @autoclosure @escaping () throws -> Bool,
                          timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        let startTime = Date().timeIntervalSinceReferenceDate
        while try !condition() {
            if Date().timeIntervalSinceReferenceDate - startTime > timeout {
                throw HammerError.waitConditionTimeout(timeout)
            }
            try self.wait(checkInterval)
        }
    }

    @discardableResult
    public func waitUntilExists<T>(_ exists: @autoclosure @escaping () throws -> T?,
                                   timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws -> T
    {
        let startTime = Date().timeIntervalSinceReferenceDate
        while true {
            if let element = try exists() {
                return element
            }
            if Date().timeIntervalSinceReferenceDate - startTime > timeout {
                throw HammerError.waitConditionTimeout(timeout)
            }
            try self.wait(checkInterval)
        }
    }

    public func waitUntilExists(_ accessibilityIdentifier: String,
                                timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntilExists(self.viewWithIdentifier(accessibilityIdentifier),
                      timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilVisible(_ accessibilityIdentifier: String, visibility: Visibility = .partial,
                                 timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.viewIsVisible(accessibilityIdentifier, visibility: visibility),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilVisible(_ view: UIView, visibility: Visibility = .partial,
                                 timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.viewIsVisible(view, visibility: visibility),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilVisible(_ rect: CGRect, visibility: Visibility = .partial,
                                 timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.rectIsVisible(rect, visibility: visibility),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilVisible(_ point: CGPoint,
                                 timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.pointIsVisible(point),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilHittable(_ accessibilityIdentifier: String,
                                  timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.viewIsHittable(accessibilityIdentifier),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilHittable(_ view: UIView,
                                  timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.viewIsHittable(view),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilHittable(_ point: CGPoint,
                                  timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws
    {
        try self.waitUntil(self.pointIsHittable(point),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilHittable(timeout: TimeInterval, checkInterval: TimeInterval = 0.1) throws {
        try self.waitUntil(self.viewIsHittable(self.mainView),
                           timeout: timeout, checkInterval: checkInterval)
    }

    public func waitUntilRunloopIsFlushed(timeout: TimeInterval) throws {
        try self.waitUntil({ waiter in
            DispatchQueue.main.async { try? waiter.complete() }
        }, timeout: timeout)
    }

    public func waitUntilFrameIsRendered(timeout: TimeInterval) throws {
        try self.waitUntil({ waiter in
            FrameTracker.shared.addNextFrameListener { try? waiter.complete() }
        }, timeout: timeout)
    }
}
