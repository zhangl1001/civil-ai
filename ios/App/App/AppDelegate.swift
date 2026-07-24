import UIKit
import Capacitor
import WebKit
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        clearWebViewResourceCache()
        // Match the app's default light theme so a resumed WKWebView never exposes
        // a black native layer while web content is being repainted.
        applyStableWebViewBackground()
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    private func clearWebViewResourceCache() {
        URLCache.shared.removeAllCachedResponses()
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: cacheTypes, modifiedSince: .distantPast) {}
    }

    private func applyStableWebViewBackground() {
        let backgroundColor = UIColor(red: 0.961, green: 0.965, blue: 0.980, alpha: 1.0) // #F5F6FA
        window?.backgroundColor = backgroundColor
        if let vc = window?.rootViewController {
            vc.view.backgroundColor = backgroundColor
            findAndStyleWebView(in: vc.view, color: backgroundColor)
        }
    }

    private func findAndStyleWebView(in view: UIView, color: UIColor) {
        if let webView = view as? WKWebView {
            webView.backgroundColor = color
            webView.scrollView.backgroundColor = color
            webView.isOpaque = true
            webView.scrollView.isOpaque = true
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            return
        }
        for subview in view.subviews {
            findAndStyleWebView(in: subview, color: color)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        NSLog("[ZhanglLifecycle] applicationWillResignActive")
    }
    func applicationDidEnterBackground(_ application: UIApplication) {
        NSLog("[ZhanglLifecycle] applicationDidEnterBackground")
    }
    func applicationWillEnterForeground(_ application: UIApplication) {
        NSLog("[ZhanglLifecycle] applicationWillEnterForeground")
    }
    func applicationDidBecomeActive(_ application: UIApplication) {
        NSLog("[ZhanglLifecycle] applicationDidBecomeActive")
        applyStableWebViewBackground()
        application.applicationIconBadgeNumber = 0
    }
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let route = response.notification.request.content.userInfo["route"] as? String {
            UserDefaults.standard.set(route, forKey: "zhangl.pendingNotificationRoute")
            NotificationCenter.default.post(name: .examTutorNotificationRoute, object: nil, userInfo: ["route": route])
        }
        completionHandler()
    }
}

extension Notification.Name {
    static let examTutorNotificationRoute = Notification.Name("examTutorNotificationRoute")
}
