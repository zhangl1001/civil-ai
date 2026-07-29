import AVFoundation
import Capacitor
import UIKit

@objc(NativeCameraPlugin)
public final class NativeCameraPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public let identifier = "NativeCameraPlugin"
    public let jsName = "NativeCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCaptureCall: CAPPluginCall?
    private let maximumImageEdge: CGFloat = 2_048
    private let maximumEncodedBytes = 6 * 1024 * 1024

    @objc func getPermission(_ call: CAPPluginCall) {
        call.resolve(["status": cameraPermissionStatus()])
    }

    @objc func capturePhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingCaptureCall == nil else {
                call.reject("已有拍照操作正在进行", "CAMERA_CAPTURE_IN_PROGRESS")
                return
            }
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.reject("当前设备没有可用相机", "CAMERA_UNAVAILABLE")
                return
            }
            self.pendingCaptureCall = call
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                self.presentCamera()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self else { return }
                        if granted {
                            self.presentCamera()
                        } else {
                            self.rejectPendingCapture("相机权限未开启", code: "CAMERA_PERMISSION_DENIED")
                        }
                    }
                }
            case .denied:
                self.rejectPendingCapture("相机权限未开启", code: "CAMERA_PERMISSION_DENIED")
            case .restricted:
                self.rejectPendingCapture("相机权限受到系统限制", code: "CAMERA_PERMISSION_RESTRICTED")
            @unknown default:
                self.rejectPendingCapture("无法读取相机权限状态", code: "CAMERA_PERMISSION_UNKNOWN")
            }
        }
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.reject("无法打开系统设置", "APP_SETTINGS_UNAVAILABLE")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["opened": true])
                } else {
                    call.reject("无法打开系统设置", "APP_SETTINGS_OPEN_FAILED")
                }
            }
        }
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { [weak self] in
            self?.pendingCaptureCall?.resolve(["cancelled": true])
            self?.pendingCaptureCall = nil
        }
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        guard let image = info[.originalImage] as? UIImage else {
            picker.dismiss(animated: true) { [weak self] in
                self?.rejectPendingCapture("没有读取到拍摄照片", code: "CAMERA_IMAGE_MISSING")
            }
            return
        }
        let prepared = prepareImage(image)
        picker.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            guard let data = self.encodedJpeg(prepared) else {
                self.rejectPendingCapture("照片压缩失败，请重新拍摄", code: "CAMERA_IMAGE_ENCODING_FAILED")
                return
            }
            let timestamp = Int(Date().timeIntervalSince1970 * 1_000)
            self.pendingCaptureCall?.resolve([
                "cancelled": false,
                "dataBase64": data.base64EncodedString(),
                "mimeType": "image/jpeg",
                "fileName": "真题拍照-\(timestamp).jpg",
                "width": Int(prepared.size.width),
                "height": Int(prepared.size.height)
            ])
            self.pendingCaptureCall = nil
        }
    }

    private func presentCamera() {
        guard let viewController = bridge?.viewController else {
            rejectPendingCapture("相机页面暂时不可用", code: "CAMERA_VIEW_UNAVAILABLE")
            return
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = self
        viewController.present(picker, animated: true)
    }

    private func prepareImage(_ image: UIImage) -> UIImage {
        let longestEdge = max(image.size.width, image.size.height)
        guard longestEdge > maximumImageEdge else { return image }
        let ratio = maximumImageEdge / longestEdge
        let target = CGSize(
            width: max(1, floor(image.size.width * ratio)),
            height: max(1, floor(image.size.height * ratio))
        )
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    private func encodedJpeg(_ image: UIImage) -> Data? {
        for quality in [0.84, 0.72, 0.6, 0.48] {
            if let data = image.jpegData(compressionQuality: quality), data.count <= maximumEncodedBytes {
                return data
            }
        }
        return nil
    }

    private func cameraPermissionStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "granted"
        case .notDetermined: return "prompt"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unknown"
        }
    }

    private func rejectPendingCapture(_ message: String, code: String) {
        pendingCaptureCall?.reject(message, code)
        pendingCaptureCall = nil
    }
}
