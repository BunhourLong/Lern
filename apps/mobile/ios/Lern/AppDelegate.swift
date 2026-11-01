internal import Expo
import React
import ReactAppDependencyProvider

// Expo modules (expo-location, expo-task-manager) register through ExpoReactNativeFactory; shape from Expo's SDK 58
// bare template (templates/expo-template-bare-minimum). super must run: it dispatches launch to Expo's subscribers,
// which is how TaskManager handles a relaunch for background location.
@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  // Expo's default is "main"; index.js registers app.json's name, which Android's MainActivity uses too
  var reactNativeFactoryModuleName: String { "Lern" }

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // SceneDelegate creates the window and starts React Native (scene-based life cycle)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    // Expo's virtual entry: resolves to this app's index.js from the workspace root Expo's Metro config serves
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
