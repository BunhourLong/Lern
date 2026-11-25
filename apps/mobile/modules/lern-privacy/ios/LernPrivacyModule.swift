import ExpoModulesCore
import UIKit

public final class LernPrivacyModule: Module {
  private let origin = ContinuousClock.now
  private var cover: UIWindow?
  private var generation = 0
  private var displayLink: CADisplayLink?
  private var readyFrames = 0
  private var expectedTag = ""
  private var requireDismissal = false
  private var deadline = 0.0
  private let revisionLock = NSLock()
  private var revision = 0
  private var expectedRevision = 0
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LernPrivacy")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: UIScene.willDeactivateNotification, object: nil, queue: .main
      ) { [weak self] note in
        guard let self, let scene = note.object as? UIWindowScene else { return }
        self.stopWaiting()
        self.generation += 1
        if self.cover == nil {
          let shield = UIWindow(windowScene: scene)
          let controller = UIViewController()
          controller.view.backgroundColor = .systemBackground
          shield.rootViewController = controller
          shield.windowLevel = .alert + 1
          shield.isHidden = false
          self.cover = shield
        }
      }
    }
    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      DispatchQueue.main.async { self.stopWaiting(); self.cover?.isHidden = true; self.cover = nil }
    }
    Function("invalidate") { () -> Int in
      self.revisionLock.withLock { self.revision += 1; return self.revision }
    }
    Function("elapsed") { self.elapsed() }
    AsyncFunction("cycle") { () -> Int in self.generation }.runOnQueue(.main)
    AsyncFunction("reveal") { (cycle: Int, tag: String, locked: Bool, deadline: Double, revision: Int) in
      guard self.generation == cycle, self.cover != nil,
            self.revisionLock.withLock({ self.revision == revision }) else { return }
      self.stopWaiting()
      self.expectedTag = tag
      self.requireDismissal = locked
      self.deadline = deadline
      self.expectedRevision = revision
      let link = CADisplayLink(target: self, selector: #selector(self.checkFrame))
      self.displayLink = link
      link.add(to: .main, forMode: .common)
    }.runOnQueue(.main)
  }

  private func elapsed() -> Double {
    let duration = origin.duration(to: .now).components
    return Double(duration.seconds) * 1000 + Double(duration.attoseconds) / 1e15
  }

  private func stopWaiting() {
    displayLink?.invalidate()
    displayLink = nil
    readyFrames = 0
  }

  @objc private func checkFrame() {
    guard let cover, let scene = cover.windowScene, scene.activationState == .foregroundActive,
          revisionLock.withLock({ revision == expectedRevision }),
          deadline == 0 || elapsed() < deadline else {
      stopWaiting()
      return
    }
    guard scene.windows.contains(where: { window in
      guard window !== cover, window.windowLevel == .normal, !window.isHidden,
            let root = window.rootViewController else { return false }
      if let modal = root.presentedViewController {
        // UIKit detaches the presenter under a full-screen modal. Its focused
        // route still names the authorized presentation for this cycle.
        guard !requireDismissal, !modal.isBeingDismissed,
              modal.transitionCoordinator == nil, modal.viewIfLoaded?.window === window,
              let presenter = modal.presentingViewController?.viewIfLoaded else { return false }
        return containsMarker(presenter, in: nil)
      }
      return root.transitionCoordinator == nil && containsMarker(window, in: window)
    }) else {
      readyFrames = 0
      return
    }
    // A display refresh must pass with this route visible and prior presentations gone.
    if readyFrames == 0 { readyFrames = 1; return }
    stopWaiting()
    cover.isHidden = true
    self.cover = nil
  }

  private func containsMarker(_ view: UIView, in window: UIWindow?) -> Bool {
    guard !view.isHidden, view.alpha > 0, !view.bounds.isEmpty else { return false }
    if view.accessibilityIdentifier == expectedTag {
      guard let window else { return true }
      guard view.window === window, let frame = view.layer.presentation(),
            let screen = window.layer.presentation() else { return false }
      return screen.bounds.intersects(frame.convert(frame.bounds, to: screen))
    }
    return view.subviews.contains { containsMarker($0, in: window) }
  }
}
