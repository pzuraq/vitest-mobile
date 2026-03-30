import ExpoModulesCore
import UIKit

public class NativeHarnessModule: Module {
  // Lazy-init event generator — reused across calls
  private var _eventGenerator: EventGenerator?

  private func eventGenerator() throws -> EventGenerator {
    if let gen = _eventGenerator { return gen }
    guard let window = Self.keyWindow() else {
      throw Exception(name: "ERR_NO_WINDOW", description: "No key window found")
    }
    let gen = try EventGenerator(window: window)
    _eventGenerator = gen
    return gen
  }

  public func definition() -> ModuleDefinition {
    Name("NativeHarness")

    // MARK: - Queries

    Function("findByTestId") { (testId: String) -> Int? in
      return onMainSync {
        guard let view = Self.findView(testId: testId) else { return nil }
        return view.tag
      }
    }

    Function("getText") { (viewTag: Int) -> String? in
      return onMainSync {
        guard let view = Self.viewByTag(viewTag) else { return nil }
        return Self.readText(from: view)
      }
    }

    Function("getFrame") { (viewTag: Int) -> [String: Double]? in
      return onMainSync {
        guard let view = Self.viewByTag(viewTag) else { return nil }
        let frame = view.convert(view.bounds, to: nil)
        return [
          "x": Double(frame.origin.x),
          "y": Double(frame.origin.y),
          "width": Double(frame.size.width),
          "height": Double(frame.size.height)
        ]
      }
    }

    Function("isVisible") { (viewTag: Int) -> Bool in
      return onMainSync {
        guard let view = Self.viewByTag(viewTag) else { return false }
        return Self.checkVisible(view)
      }
    }

    Function("getViewInfo") { (viewTag: Int) -> [String: Any]? in
      return onMainSync {
        guard let view = Self.viewByTag(viewTag) else { return nil }
        let frame = view.convert(view.bounds, to: nil)
        return [
          "testId": view.accessibilityIdentifier as Any,
          "text": Self.readText(from: view) as Any,
          "isVisible": Self.checkVisible(view),
          "isEnabled": view.isUserInteractionEnabled,
          "frame": [
            "x": Double(frame.origin.x),
            "y": Double(frame.origin.y),
            "width": Double(frame.size.width),
            "height": Double(frame.size.height)
          ]
        ]
      }
    }

    // MARK: - Interactions (via Hammer)

    AsyncFunction("tap") { [weak self] (viewTag: Int, promise: Promise) in
      DispatchQueue.main.async {
        do {
          guard let view = Self.viewByTag(viewTag) else {
            promise.reject(Exception(name: "ERR_VIEW_NOT_FOUND", description: "View with tag \(viewTag) not found"))
            return
          }
          let gen = try self?.eventGenerator()
          try gen?.fingerTap(at: view)
          // Give UIKit time to process the event and React to re-render
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            promise.resolve(nil)
          }
        } catch {
          promise.reject(Exception(name: "ERR_TAP_FAILED", description: error.localizedDescription))
        }
      }
    }

    AsyncFunction("longPress") { [weak self] (viewTag: Int, durationMs: Double, promise: Promise) in
      DispatchQueue.main.async {
        do {
          guard let view = Self.viewByTag(viewTag) else {
            promise.reject(Exception(name: "ERR_VIEW_NOT_FOUND", description: "View with tag \(viewTag) not found"))
            return
          }
          let gen = try self?.eventGenerator()
          try gen?.fingerDown(at: view)
          DispatchQueue.main.asyncAfter(deadline: .now() + durationMs / 1000.0) {
            do {
              try gen?.fingerUp()
              DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                promise.resolve(nil)
              }
            } catch {
              promise.reject(Exception(name: "ERR_LONG_PRESS_FAILED", description: error.localizedDescription))
            }
          }
        } catch {
          promise.reject(Exception(name: "ERR_LONG_PRESS_FAILED", description: error.localizedDescription))
        }
      }
    }

    AsyncFunction("typeText") { [weak self] (text: String, promise: Promise) in
      DispatchQueue.main.async {
        do {
          let gen = try self?.eventGenerator()
          try gen?.keyType(text)
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            promise.resolve(nil)
          }
        } catch {
          promise.reject(Exception(name: "ERR_TYPE_FAILED", description: error.localizedDescription))
        }
      }
    }
  }

  // MARK: - View tree traversal

  static func findView(testId: String) -> UIView? {
    guard let window = keyWindow() else { return nil }
    return findInSubviews(of: window, matching: { $0.accessibilityIdentifier == testId })
  }

  private static func findInSubviews(of root: UIView, matching predicate: (UIView) -> Bool) -> UIView? {
    var queue: [UIView] = [root]
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if predicate(view) { return view }
      queue.append(contentsOf: view.subviews)
    }
    return nil
  }

  static func viewByTag(_ tag: Int) -> UIView? {
    guard let window = keyWindow() else { return nil }
    return findInSubviews(of: window, matching: { $0.tag == tag })
  }

  // MARK: - Text reading

  static func readText(from view: UIView) -> String? {
    if let label = view as? UILabel { return label.text }
    if let textField = view as? UITextField { return textField.text }
    if let textView = view as? UITextView { return textView.text }
    var texts: [String] = []
    collectText(from: view, into: &texts)
    if !texts.isEmpty { return texts.joined() }
    return view.accessibilityLabel
  }

  private static func collectText(from view: UIView, into texts: inout [String]) {
    if let label = view as? UILabel, let text = label.text, !text.isEmpty {
      texts.append(text)
      return
    }
    for subview in view.subviews {
      collectText(from: subview, into: &texts)
    }
  }

  // MARK: - Visibility

  static func checkVisible(_ view: UIView) -> Bool {
    if view.isHidden { return false }
    if view.alpha < 0.01 { return false }
    if view.frame.isEmpty { return false }
    var parent = view.superview
    while let p = parent {
      if p.isHidden || p.alpha < 0.01 { return false }
      parent = p.superview
    }
    return true
  }

  // MARK: - Helpers

  private static func keyWindow() -> UIWindow? {
    if #available(iOS 15.0, *) {
      return UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }
    } else {
      return UIApplication.shared.windows.first { $0.isKeyWindow }
    }
  }
}

// MARK: - Main thread helper

private func onMainSync<T>(_ block: @escaping () -> T) -> T {
  if Thread.isMainThread { return block() }
  var result: T!
  DispatchQueue.main.sync { result = block() }
  return result
}
