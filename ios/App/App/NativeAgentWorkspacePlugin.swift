import Capacitor
import Foundation

@objc(NativeAgentWorkspacePlugin)
public final class NativeAgentWorkspacePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAgentWorkspacePlugin"
    public let jsName = "NativeAgentWorkspace"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "append", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.zhangl.agent.workspace", qos: .utility)

    @objc func append(_ call: CAPPluginCall) {
        guard let logKey = call.getString("logKey"), let line = call.getString("line") else {
            call.reject("Agent workspace append requires logKey and line")
            return
        }
        queue.async {
            do {
                let url = try self.logURL(logKey: logKey)
                let data = Data("\(line)\n".utf8)
                if FileManager.default.fileExists(atPath: url.path) {
                    let handle = try FileHandle(forWritingTo: url)
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                    try handle.close()
                } else {
                    try data.write(to: url, options: .atomic)
                }
                call.resolve()
            } catch {
                call.reject("Unable to append Agent workspace log", nil, error)
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let logKey = call.getString("logKey") else {
            call.reject("Agent workspace read requires logKey")
            return
        }
        queue.async {
            do {
                let url = try self.logURL(logKey: logKey)
                guard FileManager.default.fileExists(atPath: url.path) else {
                    call.resolve(["content": ""])
                    return
                }
                let content = try String(contentsOf: url, encoding: .utf8)
                call.resolve(["content": content])
            } catch {
                call.reject("Unable to read Agent workspace log", nil, error)
            }
        }
    }

    @objc func delete(_ call: CAPPluginCall) {
        guard let logKey = call.getString("logKey") else {
            call.reject("Agent workspace delete requires logKey")
            return
        }
        queue.async {
            do {
                let url = try self.logURL(logKey: logKey)
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
                call.resolve()
            } catch {
                call.reject("Unable to delete Agent workspace log", nil, error)
            }
        }
    }

    private func logURL(logKey: String) throws -> URL {
        guard !logKey.isEmpty else {
            throw NSError(domain: "NativeAgentWorkspace", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Agent workspace logKey is empty"
            ])
        }
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("ZhanglAgent/AgentWorkspace", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileName = Data(logKey.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return directory.appendingPathComponent("\(fileName).jsonl", isDirectory: false)
    }
}
