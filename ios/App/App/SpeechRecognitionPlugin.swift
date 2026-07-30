import AVFoundation
import Capacitor
import Foundation
import Speech

@objc(SpeechRecognitionPlugin)
public final class SpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechRecognitionPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestSpeechPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private var transcript = ""
    private var startedAt: Date?
    private var lifecycleObservers: [NSObjectProtocol] = []

    public override func load() {
        super.load()
        let center = NotificationCenter.default
        for name in [
            UIApplication.willResignActiveNotification,
            UIApplication.didEnterBackgroundNotification
        ] {
            lifecycleObservers.append(center.addObserver(
                forName: name,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.teardownRecognition()
            })
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": recognizer?.isAvailable == true
        ])
    }

    @objc func requestSpeechPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            AVAudioSession.sharedInstance().requestRecordPermission { micGranted in
                let granted = speechStatus == .authorized && micGranted
                call.resolve(["granted": granted])
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.startOnMain(call)
        }
    }

    private func startOnMain(_ call: CAPPluginCall) {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("Speech recognizer is unavailable", "SPEECH_UNAVAILABLE")
            return
        }
        stopRecognition()
        transcript = ""
        startedAt = Date()

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("Audio session setup failed", "AUDIO_SESSION_FAILED", error)
            return
        }

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
            call.reject("Audio input is unavailable", "AUDIO_INPUT_UNAVAILABLE")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let text = result?.bestTranscription.formattedString {
                    self.transcript = text
                }
                if error != nil || result?.isFinal == true {
                    self.teardownRecognition()
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            call.resolve()
        } catch {
            teardownRecognition()
            call.reject("Audio engine start failed", "AUDIO_ENGINE_FAILED", error)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve(["transcript": "", "durationSeconds": 0])
                return
            }
            let duration = self.startedAt.map { Date().timeIntervalSince($0) } ?? 0
            self.teardownRecognition()
            call.resolve([
                "transcript": self.transcript,
                "durationSeconds": Int(duration.rounded())
            ])
        }
    }

    private func stopRecognition() {
        teardownRecognition()
    }

    private func teardownRecognition() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        if Thread.isMainThread {
            teardownRecognition()
        } else {
            DispatchQueue.main.sync { teardownRecognition() }
        }
    }
}
