import Capacitor
import Foundation
import PDFKit
import UIKit
import Vision

@objc(NativeDocumentTextPlugin)
public final class NativeDocumentTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeDocumentTextPlugin"
    public let jsName = "NativeDocumentText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.zhangl.document-text", qos: .userInitiated)
    private let maximumBytes = 25 * 1024 * 1024
    private let maximumPages = 120
    private let maximumCharacters = 500_000

    @objc func extract(_ call: CAPPluginCall) {
        guard let encoded = call.getString("dataBase64"),
              let data = Data(base64Encoded: encoded),
              !data.isEmpty else {
            call.reject("文件内容为空或编码无效", "DOCUMENT_DATA_INVALID")
            return
        }
        guard data.count <= maximumBytes else {
            call.reject("文件不能超过 25 MB", "DOCUMENT_TOO_LARGE")
            return
        }
        let mimeType = call.getString("mimeType")?.lowercased() ?? ""
        let fileName = call.getString("fileName")?.lowercased() ?? ""

        queue.async { [weak self] in
            guard let self else { return }
            do {
                let result = if mimeType == "application/pdf" || fileName.hasSuffix(".pdf") {
                    try self.extractPDF(data)
                } else if mimeType.hasPrefix("image/") {
                    try self.extractImage(data)
                } else {
                    throw DocumentTextError.unsupportedType
                }
                call.resolve(result)
            } catch let error as DocumentTextError {
                call.reject(error.message, error.code)
            } catch {
                call.reject("文字识别失败", "DOCUMENT_EXTRACTION_FAILED", error)
            }
        }
    }

    private func extractPDF(_ data: Data) throws -> [String: Any] {
        guard let document = PDFDocument(data: data) else {
            throw DocumentTextError.invalidPDF
        }
        guard document.pageCount > 0 else {
            throw DocumentTextError.emptyDocument
        }
        guard document.pageCount <= maximumPages else {
            throw DocumentTextError.tooManyPages(maximumPages)
        }

        var pages: [String] = []
        var warnings: [String] = []
        var usedOCR = false
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            var text = normalize(page.string ?? "")
            if text.count < 12 {
                usedOCR = true
                let image = page.thumbnail(of: CGSize(width: 1_800, height: 2_400), for: .mediaBox)
                if let cgImage = image.cgImage {
                    text = try recognizeText(cgImage)
                }
            }
            if text.isEmpty {
                warnings.append("第 \(index + 1) 页没有识别到文字。")
            } else {
                pages.append("## 第 \(index + 1) 页\n\n\(text)")
            }
        }
        return try response(
            text: pages.joined(separator: "\n\n"),
            method: usedOCR ? "pdf_ocr" : "pdf_text",
            pageCount: document.pageCount,
            warnings: warnings
        )
    }

    private func extractImage(_ data: Data) throws -> [String: Any] {
        let request = recognitionRequest()
        let handler = VNImageRequestHandler(data: data, options: [:])
        try handler.perform([request])
        let text = recognizedLines(request)
        return try response(text: text, method: "image_ocr", pageCount: 1, warnings: [])
    }

    private func recognizeText(_ image: CGImage) throws -> String {
        let request = recognitionRequest()
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        return recognizedLines(request)
    }

    private func recognitionRequest() -> VNRecognizeTextRequest {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.minimumTextHeight = 0.008
        return request
    }

    private func recognizedLines(_ request: VNRecognizeTextRequest) -> String {
        let observations = (request.results ?? []).sorted { left, right in
            let verticalDifference = abs(left.boundingBox.midY - right.boundingBox.midY)
            if verticalDifference < 0.015 {
                return left.boundingBox.minX < right.boundingBox.minX
            }
            return left.boundingBox.midY > right.boundingBox.midY
        }
        return normalize(observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
    }

    private func response(
        text: String,
        method: String,
        pageCount: Int,
        warnings: [String]
    ) throws -> [String: Any] {
        let normalized = normalize(text)
        guard !normalized.isEmpty else {
            throw DocumentTextError.noRecognizedText
        }
        let wasTruncated = normalized.count > maximumCharacters
        return [
            "text": String(normalized.prefix(maximumCharacters)),
            "method": method,
            "pageCount": pageCount,
            "warnings": warnings + (wasTruncated ? ["文件较长，已保留前 50 万字。"] : [])
        ]
    }

    private func normalize(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private enum DocumentTextError: Error {
    case unsupportedType
    case invalidPDF
    case emptyDocument
    case tooManyPages(Int)
    case noRecognizedText

    var code: String {
        switch self {
        case .unsupportedType: "DOCUMENT_TYPE_UNSUPPORTED"
        case .invalidPDF: "PDF_INVALID"
        case .emptyDocument: "DOCUMENT_EMPTY"
        case .tooManyPages: "DOCUMENT_PAGE_LIMIT"
        case .noRecognizedText: "DOCUMENT_TEXT_EMPTY"
        }
    }

    var message: String {
        switch self {
        case .unsupportedType: "仅支持 PDF 和图片文字识别"
        case .invalidPDF: "PDF 文件无效或已损坏"
        case .emptyDocument: "文件没有可读取的页面"
        case let .tooManyPages(limit): "PDF 不能超过 \(limit) 页"
        case .noRecognizedText: "没有识别到可读取的文字"
        }
    }
}
