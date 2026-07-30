import Capacitor
import Foundation
import UIKit
import UserNotifications

struct LearningNotificationPayload: Decodable {
    let items: [LearningNotificationItem]
}

struct LearningNotificationItem: Decodable {
    let id: String
    let title: String
    let body: String
    let at: String
    let route: String
}

@objc(LearningNotificationPlugin)
public final class LearningNotificationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LearningNotificationPlugin"
    public let jsName = "LearningNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingRoute", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error { call.reject(error.localizedDescription, "NOTIFICATION_PERMISSION_FAILED", error); return }
            call.resolve(["granted": granted])
        }
    }

    private func parseDate(_ dateString: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateString) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: dateString)
    }

    @objc func schedule(_ call: CAPPluginCall) {
        do {
            let payload = try call.decode(LearningNotificationPayload.self)
            let center = UNUserNotificationCenter.current()
            let ids = payload.items.map { $0.id }
            center.removePendingNotificationRequests(withIdentifiers: ids)
            let validItems = payload.items.compactMap { item -> (LearningNotificationItem, Date)? in
                guard let date = parseDate(item.at), date > Date() else { return nil }
                return (item, date)
            }
            guard !validItems.isEmpty else {
                call.resolve(["scheduled": 0, "failed": 0])
                return
            }

            let group = DispatchGroup()
            let resultLock = NSLock()
            var scheduled = 0
            var failures: [String] = []
            for (item, date) in validItems {
                let content = UNMutableNotificationContent()
                content.title = item.title
                content.body = item.body
                content.sound = .default
                content.userInfo = ["route": item.route]
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                let request = UNNotificationRequest(identifier: item.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
                group.enter()
                center.add(request) { error in
                    resultLock.lock()
                    if let error {
                        failures.append("\(item.id): \(error.localizedDescription)")
                    } else {
                        scheduled += 1
                    }
                    resultLock.unlock()
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                call.resolve([
                    "scheduled": scheduled,
                    "failed": failures.count,
                    "errors": failures
                ])
            }
        } catch {
            call.reject("Invalid notification payload", "NOTIFICATION_PAYLOAD_INVALID", error)
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            center.getPendingNotificationRequests { requests in
                let authorization: String
                switch settings.authorizationStatus {
                case .authorized: authorization = "authorized"
                case .denied: authorization = "denied"
                case .notDetermined: authorization = "notDetermined"
                case .provisional: authorization = "provisional"
                case .ephemeral: authorization = "ephemeral"
                @unknown default: authorization = "unknown"
                }
                call.resolve([
                    "native": true,
                    "authorization": authorization,
                    "pending": requests.count
                ])
            }
        }
    }

    @objc func clearAll(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
            call.resolve()
        }
    }

    @objc func consumePendingRoute(_ call: CAPPluginCall) {
        let key = "zhangl.pendingNotificationRoute"
        let maxPendingRouteAge: TimeInterval = 300
        defer { UserDefaults.standard.removeObject(forKey: key) }
        if let payload = UserDefaults.standard.dictionary(forKey: key),
           let route = payload["route"] as? String,
           let at = payload["at"] as? TimeInterval {
            if Date().timeIntervalSince1970 - at <= maxPendingRouteAge {
                call.resolve(["route": route])
            } else {
                call.resolve(["route": NSNull()])
            }
            return
        }
        let legacyRoute = UserDefaults.standard.string(forKey: key)
        call.resolve(["route": legacyRoute ?? NSNull()])
    }
}
