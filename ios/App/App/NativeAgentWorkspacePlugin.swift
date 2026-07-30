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
    private let maximumKeyBytes = 256
    private let maximumLineBytes = 64 * 1_024
    private let maximumFileBytes = 4 * 1_024 * 1_024
    private let maximumFileCount = 64
    private let maximumWorkspaceBytes = 32 * 1_024 * 1_024

    @objc func append(_ call: CAPPluginCall) {
        guard let logKey = call.getString("logKey"), let line = call.getString("line") else {
            call.reject("Agent workspace append requires logKey and line")
            return
        }
        guard line.utf8.count <= maximumLineBytes else {
            call.reject("Agent workspace line exceeds the 64 KB limit")
            return
        }
        queue.async {
            do {
                let url = try self.logURL(logKey: logKey)
                let data = Data("\(line)\n".utf8)
                let state = try self.workspaceState(for: url)
                guard state.fileBytes + data.count <= self.maximumFileBytes else {
                    throw WorkspaceError.fileLimit
                }
                guard state.totalBytes + data.count <= self.maximumWorkspaceBytes else {
                    throw WorkspaceError.totalLimit
                }
                guard state.fileExists || state.fileCount < self.maximumFileCount else {
                    throw WorkspaceError.fileCountLimit
                }
                if state.fileExists {
                    let handle = try FileHandle(forWritingTo: url)
                    defer { try? handle.close() }
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
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
                let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
                let fileBytes = (attributes[.size] as? NSNumber)?.intValue ?? 0
                guard fileBytes <= self.maximumFileBytes else {
                    throw WorkspaceError.fileLimit
                }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                guard let content = String(data: data, encoding: .utf8) else {
                    throw WorkspaceError.invalidEncoding
                }
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
        guard !logKey.isEmpty, logKey.utf8.count <= maximumKeyBytes else {
            throw WorkspaceError.invalidKey
        }
        let directory = try workspaceDirectory()
        let fileName = Data(logKey.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        return directory.appendingPathComponent("\(fileName).jsonl", isDirectory: false)
    }

    private func workspaceDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("ZhanglAgent/AgentWorkspace", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func workspaceState(for target: URL) throws -> (
        fileExists: Bool,
        fileBytes: Int,
        fileCount: Int,
        totalBytes: Int
    ) {
        let directory = try workspaceDirectory()
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey]
        let files = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )
        var fileCount = 0
        var totalBytes = 0
        var targetBytes = 0
        var targetExists = false
        for file in files {
            let values = try file.resourceValues(forKeys: keys)
            guard values.isRegularFile == true else { continue }
            fileCount += 1
            let size = values.fileSize ?? 0
            totalBytes += size
            if file.standardizedFileURL == target.standardizedFileURL {
                targetExists = true
                targetBytes = size
            }
        }
        return (targetExists, targetBytes, fileCount, totalBytes)
    }
}

private enum WorkspaceError: LocalizedError {
    case invalidKey
    case fileLimit
    case fileCountLimit
    case totalLimit
    case invalidEncoding

    var errorDescription: String? {
        switch self {
        case .invalidKey: "Agent workspace logKey is empty or too long"
        case .fileLimit: "Agent workspace file exceeds the 4 MB limit"
        case .fileCountLimit: "Agent workspace exceeds the 64-file limit"
        case .totalLimit: "Agent workspace exceeds the 32 MB total limit"
        case .invalidEncoding: "Agent workspace log is not valid UTF-8"
        }
    }
}
