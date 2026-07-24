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

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            if let text = result?.bestTranscription.formattedString {
                self?.transcript = text
            }
            if error != nil || result?.isFinal == true {
                self?.audioEngine.stop()
                inputNode.removeTap(onBus: 0)
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            call.resolve()
        } catch {
            stopRecognition()
            call.reject("Audio engine start failed", "AUDIO_ENGINE_FAILED", error)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        stopRecognition()
        call.resolve([
            "transcript": transcript,
            "durationSeconds": Int(duration.rounded())
        ])
    }

    private func stopRecognition() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
