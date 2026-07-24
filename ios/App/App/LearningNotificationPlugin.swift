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
            for item in payload.items {
                guard let date = parseDate(item.at), date > Date() else { continue }
                let content = UNMutableNotificationContent()
                content.title = item.title
                content.body = item.body
                content.sound = .default
                content.userInfo = ["route": item.route]
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                let request = UNNotificationRequest(identifier: item.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
                center.add(request)
            }
            call.resolve(["scheduled": ids.count])
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
        let route = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        call.resolve(["route": route ?? NSNull()])
    }
}
