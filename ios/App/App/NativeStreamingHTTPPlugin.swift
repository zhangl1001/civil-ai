import Capacitor
import Darwin
import Foundation

@objc(NativeStreamingHTTPPlugin)
public final class NativeStreamingHTTPPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate, URLSessionTaskDelegate {
    public let identifier = "NativeStreamingHTTPPlugin"
    public let jsName = "NativeStreamingHTTP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startStream", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelStream", returnType: CAPPluginReturnPromise)
    ]

    private enum RequestPurpose: String {
        case model
        case publicWeb
    }

    private final class StreamContext {
        let requestId: String
        let session: URLSession
        let task: URLSessionDataTask
        let originalHost: String
        let method: String
        let purpose: RequestPurpose
        var receivedByteCount = 0
        var receivedEventCount = 0
        var pendingEventCount = 0
        var terminalError: String?

        init(
            requestId: String,
            session: URLSession,
            task: URLSessionDataTask,
            originalHost: String,
            method: String,
            purpose: RequestPurpose
        ) {
            self.requestId = requestId
            self.session = session
            self.task = task
            self.originalHost = originalHost
            self.method = method
            self.purpose = purpose
        }
    }

    private static let maximumConcurrentStreams = 4
    private static let maximumRequestBodyBytes = 8 * 1_024 * 1_024
    private static let maximumResponseBytes = 32 * 1_024 * 1_024
    private static let maximumChunkBytes = 1 * 1_024 * 1_024
    private static let maximumDataEvents = 4_096
    private static let maximumPendingEvents = 64
    private static let requestTimeout: TimeInterval = 300
    private static let resourceTimeout: TimeInterval = 900
    private static let modelHeaders: Set<String> = [
        "accept",
        "anthropic-beta",
        "anthropic-version",
        "authorization",
        "content-type",
        "idempotency-key",
        "openai-organization",
        "openai-project",
        "x-api-key",
        "x-client-request-id"
    ]
    private static let publicWebHeaders: Set<String> = [
        "accept",
        "accept-language",
        "authorization",
        "x-respond-with",
        "x-subscription-token"
    ]
    private static let sensitiveHeaders: Set<String> = [
        "authorization",
        "x-api-key",
        "x-subscription-token"
    ]

    private let lock = NSLock()
    private var streams: [ObjectIdentifier: StreamContext] = [:]

    @objc func getStatus(_ call: CAPPluginCall) {
        lock.lock()
        let activeStreamCount = streams.count
        lock.unlock()
        call.resolve([
            "available": true,
            "version": 3,
            "activeStreamCount": activeStreamCount,
            "maximumConcurrentStreams": Self.maximumConcurrentStreams
        ])
    }

    @objc func startStream(_ call: CAPPluginCall) {
        guard
            let requestId = call.getString("requestId"),
            let urlValue = call.getString("url"),
            let url = URL(string: urlValue)
        else {
            call.reject("Native stream request is missing requestId or URL")
            return
        }

        guard let purpose = RequestPurpose(rawValue: call.getString("purpose") ?? RequestPurpose.model.rawValue) else {
            call.reject("Native HTTP request has an unsupported purpose")
            return
        }
        let method = (call.getString("method") ?? "POST").uppercased()
        let expectedMethod = purpose == .model ? "POST" : "GET"
        guard method == expectedMethod else {
            call.reject("Native HTTP \(purpose.rawValue) requests only allow \(expectedMethod)")
            return
        }

        let validatedHost: String
        do {
            validatedHost = try NativeNetworkTargetPolicy.validate(url)
        } catch {
            call.reject("Native HTTP endpoint rejected: \(error.localizedDescription)")
            return
        }

        let rawHeaders = call.getObject("headers") ?? [:]
        let headers: [String: String]
        do {
            headers = try validateHeaders(rawHeaders, purpose: purpose)
        } catch {
            call.reject(error.localizedDescription)
            return
        }

        let body = call.getString("body") ?? ""
        guard body.utf8.count <= Self.maximumRequestBodyBytes else {
            call.reject("Native HTTP request body exceeds the 8 MB limit")
            return
        }

        lock.lock()
        let hasDuplicateRequest = streams.values.contains { $0.requestId == requestId }
        let atCapacity = streams.count >= Self.maximumConcurrentStreams
        lock.unlock()
        guard !hasDuplicateRequest else {
            call.reject("Native model requestId is already active")
            return
        }
        guard !atCapacity else {
            call.reject("Native model transport is at its 4-request concurrency limit")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = Self.requestTimeout
        headers.forEach { key, value in
            request.setValue(value, forHTTPHeaderField: key)
        }
        if method == "POST" {
            request.httpBody = Data(body.utf8)
        }
        request.httpShouldHandleCookies = false

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpMaximumConnectionsPerHost = Self.maximumConcurrentStreams
        configuration.timeoutIntervalForRequest = Self.requestTimeout
        configuration.timeoutIntervalForResource = Self.resourceTimeout
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.dataTask(with: request)
        let key = ObjectIdentifier(task)
        let context = StreamContext(
            requestId: requestId,
            session: session,
            task: task,
            originalHost: validatedHost,
            method: method,
            purpose: purpose
        )
        lock.lock()
        guard streams.count < Self.maximumConcurrentStreams else {
            lock.unlock()
            session.invalidateAndCancel()
            call.reject("Native model transport is at its 4-request concurrency limit")
            return
        }
        streams[key] = context
        lock.unlock()
        NSLog("[NativeStreamingHTTP] start request=%@", requestId)
        task.resume()
        call.resolve(["requestId": requestId])
    }

    @objc func cancelStream(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else {
            call.reject("Native stream cancellation is missing requestId")
            return
        }
        lock.lock()
        let matching = streams.values.filter { $0.requestId == requestId }
        lock.unlock()
        matching.forEach { $0.task.cancel() }
        call.resolve()
    }

    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let context = context(for: dataTask) else {
            completionHandler(.cancel)
            return
        }
        let http = response as? HTTPURLResponse
        let headers = (http?.allHeaderFields ?? [:]).reduce(into: [String: String]()) { result, item in
            result[String(describing: item.key)] = String(describing: item.value)
        }
        var jsHeaders: JSObject = [:]
        headers.forEach { key, value in jsHeaders[key] = value }
        emit([
            "requestId": context.requestId,
            "type": "response",
            "status": http?.statusCode ?? 200,
            "headers": jsHeaders,
            "url": response.url?.absoluteString ?? NSNull()
        ])
        NSLog(
            "[NativeStreamingHTTP] response request=%@ status=%d",
            context.requestId,
            http?.statusCode ?? 200
        )
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let reservation = reserveDataEvent(for: dataTask, byteCount: data.count)
        guard case let .success(context) = reservation else {
            if case let .failure(message) = reservation {
                terminate(dataTask, message: message)
            }
            return
        }
        emit([
            "requestId": context.requestId,
            "type": "data",
            "base64": data.base64EncodedString()
        ]) { [weak self, weak context] in
            guard let self, let context else { return }
            self.lock.lock()
            context.pendingEventCount = max(0, context.pendingEventCount - 1)
            self.lock.unlock()
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard
            let dataTask = task as? URLSessionDataTask,
            let context = context(for: dataTask),
            let redirectURL = request.url
        else {
            completionHandler(nil)
            return
        }
        do {
            let redirectHost = try NativeNetworkTargetPolicy.validate(redirectURL)
            guard request.httpMethod?.uppercased() == context.method else {
                throw NativeNetworkTargetPolicy.ValidationError.redirectChangedMethod
            }
            if context.purpose == .model, redirectHost != context.originalHost {
                throw NativeNetworkTargetPolicy.ValidationError.crossHostRedirect
            }
            var safeRequest = request
            if context.purpose == .publicWeb, redirectHost != context.originalHost {
                Self.sensitiveHeaders.forEach {
                    safeRequest.setValue(nil, forHTTPHeaderField: $0)
                }
            }
            completionHandler(safeRequest)
        } catch {
            setTerminalError(
                for: dataTask,
                message: "Native HTTP redirect rejected: \(error.localizedDescription)"
            )
            completionHandler(nil)
            dataTask.cancel()
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let dataTask = task as? URLSessionDataTask else { return }
        let key = ObjectIdentifier(dataTask)
        lock.lock()
        let context = streams.removeValue(forKey: key)
        lock.unlock()
        guard let context else { return }
        let completionError = context.terminalError ?? error?.localizedDescription
        if let completionError {
            NSLog(
                "[NativeStreamingHTTP] complete request=%@ error=%@",
                context.requestId,
                completionError
            )
        } else {
            NSLog("[NativeStreamingHTTP] complete request=%@", context.requestId)
        }
        emit([
            "requestId": context.requestId,
            "type": "complete",
            "error": completionError ?? NSNull()
        ])
        context.session.finishTasksAndInvalidate()
    }

    private func context(for task: URLSessionDataTask) -> StreamContext? {
        lock.lock()
        defer { lock.unlock() }
        return streams[ObjectIdentifier(task)]
    }

    private enum DataEventReservation {
        case success(StreamContext)
        case failure(String)
        case missing
    }

    private func reserveDataEvent(
        for task: URLSessionDataTask,
        byteCount: Int
    ) -> DataEventReservation {
        lock.lock()
        defer { lock.unlock() }
        guard let context = streams[ObjectIdentifier(task)] else { return .missing }
        if byteCount > Self.maximumChunkBytes {
            return .failure("Native HTTP response chunk exceeds the 1 MB limit")
        }
        if context.receivedByteCount + byteCount > Self.maximumResponseBytes {
            return .failure("Native HTTP response exceeds the 32 MB limit")
        }
        if context.receivedEventCount + 1 > Self.maximumDataEvents {
            return .failure("Native HTTP response exceeds the 4096-event limit")
        }
        if context.pendingEventCount + 1 > Self.maximumPendingEvents {
            return .failure("Native HTTP stream consumer cannot keep up with the response")
        }
        context.receivedByteCount += byteCount
        context.receivedEventCount += 1
        context.pendingEventCount += 1
        return .success(context)
    }

    private func terminate(_ task: URLSessionDataTask, message: String) {
        setTerminalError(for: task, message: message)
        task.cancel()
    }

    private func setTerminalError(for task: URLSessionDataTask, message: String) {
        lock.lock()
        if let context = streams[ObjectIdentifier(task)], context.terminalError == nil {
            context.terminalError = message
        }
        lock.unlock()
    }

    private func validateHeaders(_ input: JSObject, purpose: RequestPurpose) throws -> [String: String] {
        let allowedHeaders = purpose == .model ? Self.modelHeaders : Self.publicWebHeaders
        guard input.count <= allowedHeaders.count else {
            throw NativeNetworkTargetPolicy.ValidationError.tooManyHeaders
        }
        var result: [String: String] = [:]
        for (key, rawValue) in input {
            let normalizedKey = key.lowercased()
            guard allowedHeaders.contains(normalizedKey) else {
                throw NativeNetworkTargetPolicy.ValidationError.disallowedHeader(key)
            }
            let value = String(describing: rawValue)
            guard value.utf8.count <= 8_192, !value.contains("\r"), !value.contains("\n") else {
                throw NativeNetworkTargetPolicy.ValidationError.invalidHeader(key)
            }
            result[key] = value
        }
        return result
    }

    private func emit(_ data: JSObject, completion: (() -> Void)? = nil) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("nativeHttpStream", data: data)
            completion?()
        }
    }

    deinit {
        lock.lock()
        let active = Array(streams.values)
        streams.removeAll()
        lock.unlock()
        active.forEach {
            $0.task.cancel()
            $0.session.invalidateAndCancel()
        }
    }
}

private enum NativeNetworkTargetPolicy {
    enum ValidationError: LocalizedError {
        case malformedURL
        case nonHTTPS
        case credentialsInURL
        case unsupportedPort
        case localHostname
        case resolutionFailed
        case nonPublicAddress
        case crossHostRedirect
        case redirectChangedMethod
        case tooManyHeaders
        case disallowedHeader(String)
        case invalidHeader(String)

        var errorDescription: String? {
            switch self {
            case .malformedURL:
                return "URL must contain a valid public host"
            case .nonHTTPS:
                return "only HTTPS endpoints are allowed"
            case .credentialsInURL:
                return "credentials must be sent in approved headers, not in the URL"
            case .unsupportedPort:
                return "only the standard HTTPS port is allowed"
            case .localHostname:
                return "local and private hostnames are not allowed"
            case .resolutionFailed:
                return "the endpoint hostname could not be resolved"
            case .nonPublicAddress:
                return "the endpoint resolves to a private, local, or reserved address"
            case .crossHostRedirect:
                return "cross-host redirects are not allowed"
            case .redirectChangedMethod:
                return "redirects may not change the original HTTP method"
            case .tooManyHeaders:
                return "native HTTP request contains too many headers"
            case let .disallowedHeader(name):
                return "native HTTP request header is not allowed: \(name)"
            case let .invalidHeader(name):
                return "native HTTP request header is invalid: \(name)"
            }
        }
    }

    static func validate(_ url: URL) throws -> String {
        guard
            url.scheme?.lowercased() == "https",
            let rawHost = url.host?.lowercased(),
            !rawHost.isEmpty
        else {
            if url.scheme?.lowercased() != "https" {
                throw ValidationError.nonHTTPS
            }
            throw ValidationError.malformedURL
        }
        guard url.user == nil, url.password == nil else {
            throw ValidationError.credentialsInURL
        }
        guard url.port == nil || url.port == 443 else {
            throw ValidationError.unsupportedPort
        }

        let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
        let blockedSuffixes = [".local", ".localhost", ".internal", ".lan", ".home", ".arpa"]
        guard
            host != "localhost",
            !blockedSuffixes.contains(where: host.hasSuffix)
        else {
            throw ValidationError.localHostname
        }

        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        hints.ai_protocol = IPPROTO_TCP
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else {
            throw ValidationError.resolutionFailed
        }
        defer { freeaddrinfo(first) }

        var cursor: UnsafeMutablePointer<addrinfo>? = first
        var foundAddress = false
        while let current = cursor {
            guard let socketAddress = current.pointee.ai_addr else {
                cursor = current.pointee.ai_next
                continue
            }
            foundAddress = true
            switch current.pointee.ai_family {
            case AF_INET:
                let address = socketAddress.withMemoryRebound(
                    to: sockaddr_in.self,
                    capacity: 1
                ) { $0.pointee.sin_addr }
                guard isPublicIPv4(UInt32(bigEndian: address.s_addr)) else {
                    throw ValidationError.nonPublicAddress
                }
            case AF_INET6:
                var address = socketAddress.withMemoryRebound(
                    to: sockaddr_in6.self,
                    capacity: 1
                ) { $0.pointee.sin6_addr }
                let bytes = withUnsafeBytes(of: &address) { Array($0) }
                guard isPublicIPv6(bytes) else {
                    throw ValidationError.nonPublicAddress
                }
            default:
                throw ValidationError.nonPublicAddress
            }
            cursor = current.pointee.ai_next
        }
        guard foundAddress else {
            throw ValidationError.resolutionFailed
        }
        return host
    }

    private static func isPublicIPv4(_ value: UInt32) -> Bool {
        let first = value >> 24
        let second = (value >> 16) & 0xff
        if first == 0 || first == 10 || first == 127 || first >= 224 { return false }
        if first == 100, (64 ... 127).contains(second) { return false }
        if first == 169, second == 254 { return false }
        if first == 172, (16 ... 31).contains(second) { return false }
        if first == 192, second == 168 { return false }
        if first == 192, second == 0 { return false }
        if first == 198, second == 18 || second == 19 { return false }
        if first == 198, second == 51 { return false }
        if first == 203, second == 0 { return false }
        return true
    }

    private static func isPublicIPv6(_ bytes: [UInt8]) -> Bool {
        guard bytes.count == 16 else { return false }
        if bytes.allSatisfy({ $0 == 0 }) { return false }
        if bytes.dropLast().allSatisfy({ $0 == 0 }), bytes.last == 1 { return false }
        if bytes[0] & 0xfe == 0xfc { return false }
        if bytes[0] == 0xfe, bytes[1] & 0xc0 == 0x80 { return false }
        if bytes[0] == 0xff { return false }
        if bytes[0] == 0x20, bytes[1] == 0x01, bytes[2] == 0x0d, bytes[3] == 0xb8 {
            return false
        }
        let isIPv4Mapped = bytes[0 ..< 10].allSatisfy { $0 == 0 }
            && bytes[10] == 0xff
            && bytes[11] == 0xff
        if isIPv4Mapped {
            let value = UInt32(bytes[12]) << 24
                | UInt32(bytes[13]) << 16
                | UInt32(bytes[14]) << 8
                | UInt32(bytes[15])
            return isPublicIPv4(value)
        }
        return true
    }
}
