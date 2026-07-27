import Capacitor
import Foundation

@objc(NativeStreamingHTTPPlugin)
public final class NativeStreamingHTTPPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
    public let identifier = "NativeStreamingHTTPPlugin"
    public let jsName = "NativeStreamingHTTP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startStream", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelStream", returnType: CAPPluginReturnPromise)
    ]

    private struct StreamContext {
        let requestId: String
        let session: URLSession
        let task: URLSessionDataTask
    }

    private let lock = NSLock()
    private var streams: [ObjectIdentifier: StreamContext] = [:]

    @objc func getStatus(_ call: CAPPluginCall) {
        lock.lock()
        let activeStreamCount = streams.count
        lock.unlock()
        call.resolve([
            "available": true,
            "version": 1,
            "activeStreamCount": activeStreamCount
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

        var request = URLRequest(url: url)
        request.httpMethod = call.getString("method") ?? "POST"
        request.timeoutInterval = 300
        call.getObject("headers")?.forEach { key, value in
            request.setValue(String(describing: value), forHTTPHeaderField: key)
        }
        if let body = call.getString("body") {
            request.httpBody = Data(body.utf8)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 300
        configuration.timeoutIntervalForResource = 360
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        let task = session.dataTask(with: request)
        let key = ObjectIdentifier(task)
        lock.lock()
        streams[key] = StreamContext(requestId: requestId, session: session, task: task)
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
            "headers": jsHeaders
        ])
        NSLog(
            "[NativeStreamingHTTP] response request=%@ status=%d",
            context.requestId,
            http?.statusCode ?? 200
        )
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let context = context(for: dataTask) else { return }
        emit([
            "requestId": context.requestId,
            "type": "data",
            "base64": data.base64EncodedString()
        ])
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
        if let error {
            NSLog(
                "[NativeStreamingHTTP] complete request=%@ error=%@",
                context.requestId,
                error.localizedDescription
            )
        } else {
            NSLog("[NativeStreamingHTTP] complete request=%@", context.requestId)
        }
        emit([
            "requestId": context.requestId,
            "type": "complete",
            "error": error?.localizedDescription ?? NSNull()
        ])
        context.session.finishTasksAndInvalidate()
    }

    private func context(for task: URLSessionDataTask) -> StreamContext? {
        lock.lock()
        defer { lock.unlock() }
        return streams[ObjectIdentifier(task)]
    }

    private func emit(_ data: JSObject) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("nativeHttpStream", data: data)
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
