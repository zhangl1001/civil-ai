import UIKit
import Capacitor
import WebKit

final class MainViewController: CAPBridgeViewController {
    private let stableBackgroundColor = UIColor(red: 0.961, green: 0.965, blue: 0.980, alpha: 1.0) // #F5F6FA
    private var lastProcessRecoveryAt: TimeInterval = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        applyStableWebBackground()
        applyStableStatusBarAppearance()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyStableWebBackground()
        applyStableStatusBarAppearance()
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        applyStableWebBackground()
        applyStableStatusBarAppearance()
        bridge?.registerPluginInstance(KeychainPlugin())
        bridge?.registerPluginInstance(LearningNotificationPlugin())
        bridge?.registerPluginInstance(SpeechRecognitionPlugin())
        bridge?.registerPluginInstance(NativeStreamingHTTPPlugin())
        bridge?.registerPluginInstance(NativeAgentWorkspacePlugin())
        bridge?.registerPluginInstance(NativeDocumentTextPlugin())
        NotificationCenter.default.addObserver(self, selector: #selector(openLearningRoute(_:)), name: .examTutorNotificationRoute, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func openLearningRoute(_ notification: Notification) {
        guard let route = notification.userInfo?["route"] as? String else { return }
        bridge?.triggerWindowJSEvent(eventName: "study-notification-open", data: route)
    }

    @objc private func appDidBecomeActive() {
        NSLog("[ZhanglLifecycle] controller didBecomeActive")
        applyNativeFallbackBackground()
        applyStableStatusBarAppearance()
        bridge?.triggerWindowJSEvent(eventName: "app-did-become-active")
        bridge?.triggerWindowJSEvent(eventName: "app-active")
        DispatchQueue.main.async { [weak self] in
            self?.triggerResumeRepaint()
            self?.refreshWebViewCompositor()
            self?.recoverWebViewIfNeeded()
        }
    }

    @objc private func appWillResignActive() {
        NSLog("[ZhanglLifecycle] controller willResignActive")
        applyNativeFallbackBackground()
        bridge?.triggerWindowJSEvent(eventName: "app-will-resign-active")
    }

    @objc private func appDidEnterBackground() {
        NSLog("[ZhanglLifecycle] controller didEnterBackground")
        applyNativeFallbackBackground()
        bridge?.triggerWindowJSEvent(eventName: "app-did-enter-background")
    }

    @objc private func appWillEnterForeground() {
        NSLog("[ZhanglLifecycle] controller willEnterForeground")
        applyNativeFallbackBackground()
        bridge?.triggerWindowJSEvent(eventName: "app-will-enter-foreground")
    }

    private func applyNativeFallbackBackground() {
        view.window?.backgroundColor = stableBackgroundColor
        view.backgroundColor = stableBackgroundColor
    }

    private func applyStableStatusBarAppearance() {
        if #available(iOS 13.0, *) {
            statusBarStyle = .darkContent
        } else {
            statusBarStyle = .default
        }
        setNeedsStatusBarAppearanceUpdate()
    }

    private func applyStableWebBackground() {
        view.window?.backgroundColor = stableBackgroundColor
        view.backgroundColor = stableBackgroundColor
        webView?.backgroundColor = stableBackgroundColor
        webView?.scrollView.backgroundColor = stableBackgroundColor
        webView?.isOpaque = false
        webView?.scrollView.isOpaque = false
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    private func triggerResumeRepaint() {
        webView?.evaluateJavaScript("""
            document.documentElement.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-solid') || '#F5F6FA';
            document.body.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-solid') || '#F5F6FA';
            window.dispatchEvent(new Event('native-resume'));
        """)
    }

    private func refreshWebViewCompositor() {
        guard let webView = webView else { return }
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        webView.scrollView.setNeedsLayout()
        webView.scrollView.layoutIfNeeded()
        webView.alpha = 0.999
        DispatchQueue.main.async { [weak webView] in
            webView?.alpha = 1.0
            webView?.setNeedsDisplay()
        }
    }

    private func recoverWebViewIfNeeded() {
        guard let webView = webView else { return }
        webView.evaluateJavaScript("JSON.stringify({ready:document.readyState,body:!!document.body,app:!!document.getElementById('app'),hidden:document.hidden})") { [weak self, weak webView] result, error in
            guard let self = self, let webView = webView else { return }
            NSLog("[ZhanglLifecycle] web health result=\(String(describing: result)) error=\(String(describing: error))")
            if error != nil || result == nil {
                self.reloadWebViewAfterProcessLoss(webView)
            }
        }
    }

    private func reloadWebViewAfterProcessLoss(_ webView: WKWebView) {
        let now = Date().timeIntervalSince1970
        guard now - lastProcessRecoveryAt > 2 else { return }
        lastProcessRecoveryAt = now
        NSLog("[ZhanglLifecycle] reloading WebView after failed health check")
        applyStableWebBackground()
        webView.reload()
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}
