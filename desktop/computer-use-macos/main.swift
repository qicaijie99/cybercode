import CoreGraphics
import Foundation
import ImageIO

private struct HelperFailure: Error {
  let code: String
  let message: String
}

private typealias JSONObject = [String: Any]

private func writeEnvelope(_ value: JSONObject) {
  do {
    let data = try JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
  } catch {
    let fallback = #"{"ok":false,"error":{"code":"json_error","message":"Failed to encode helper response"}}"#
    FileHandle.standardOutput.write(Data(fallback.utf8))
    FileHandle.standardOutput.write(Data([0x0a]))
  }
}

private func fail(_ error: HelperFailure) -> Never {
  writeEnvelope([
    "ok": false,
    "error": [
      "code": error.code,
      "message": error.message,
    ],
  ])
  exit(1)
}

private func number(_ payload: JSONObject, _ key: String) -> Double? {
  if let value = payload[key] as? NSNumber {
    return value.doubleValue
  }
  return nil
}

private func integer(_ payload: JSONObject, _ key: String) -> Int? {
  number(payload, key).map { Int($0.rounded()) }
}

private func displayIdentifier(_ payload: JSONObject, _ key: String) -> CGDirectDisplayID? {
  guard let value = integer(payload, key), value >= 0 else {
    return nil
  }
  return CGDirectDisplayID(value)
}

private func activeDisplayIdentifiers() throws -> [CGDirectDisplayID] {
  var displays = [CGDirectDisplayID](repeating: 0, count: 32)
  var count: UInt32 = 0
  let result = CGGetActiveDisplayList(UInt32(displays.count), &displays, &count)
  guard result == .success else {
    throw HelperFailure(
      code: "display_list_failed",
      message: "CGGetActiveDisplayList failed with code \(result.rawValue)"
    )
  }
  return Array(displays.prefix(Int(count)))
}

private func displayGeometry(_ displayID: CGDirectDisplayID, index: Int) -> JSONObject {
  let bounds = CGDisplayBounds(displayID)
  let logicalWidth = max(1, Int(bounds.width.rounded()))
  let logicalHeight = max(1, Int(bounds.height.rounded()))
  let pixelWidth = max(1, CGDisplayPixelsWide(displayID))
  let scaleFactor = Double(pixelWidth) / Double(logicalWidth)
  let name = "Display \(index + 1)"

  return [
    "id": Int(displayID),
    "displayId": Int(displayID),
    "width": logicalWidth,
    "height": logicalHeight,
    "scaleFactor": scaleFactor,
    "originX": Int(bounds.origin.x.rounded()),
    "originY": Int(bounds.origin.y.rounded()),
    "isPrimary": displayID == CGMainDisplayID() || CGDisplayIsMain(displayID) != 0,
    "name": name,
    "label": name,
  ]
}

private func listDisplays() throws -> [JSONObject] {
  try activeDisplayIdentifiers().enumerated().map { index, displayID in
    displayGeometry(displayID, index: index)
  }
}

private func chooseDisplay(_ requestedID: CGDirectDisplayID?) throws -> JSONObject {
  let displays = try listDisplays()
  guard !displays.isEmpty else {
    throw HelperFailure(code: "no_display", message: "No active displays were found")
  }

  if let requestedID {
    if let display = displays.first(where: {
      ($0["displayId"] as? Int) == Int(requestedID)
    }) {
      return display
    }
    throw HelperFailure(
      code: "unknown_display",
      message: "Unknown display: \(requestedID)"
    )
  }

  return displays.first(where: { ($0["isPrimary"] as? Bool) == true }) ?? displays[0]
}

private func requireScreenRecordingPermission() throws {
  if CGPreflightScreenCaptureAccess() {
    return
  }
  if CGRequestScreenCaptureAccess() && CGPreflightScreenCaptureAccess() {
    return
  }
  throw HelperFailure(
    code: "SCREEN_CAPTURE_PERMISSION_REQUIRED",
    message: "Screen Recording permission is required for CyberCode Computer Use"
  )
}

private func resizedImage(_ image: CGImage, width: Int?, height: Int?) throws -> CGImage {
  guard let width, let height, width > 0, height > 0 else {
    return image
  }
  if image.width == width && image.height == height {
    return image
  }

  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
    | CGImageAlphaInfo.premultipliedLast.rawValue
  guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ) else {
    throw HelperFailure(code: "resize_failed", message: "Could not create image context")
  }

  context.interpolationQuality = .high
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  guard let output = context.makeImage() else {
    throw HelperFailure(code: "resize_failed", message: "Could not resize screenshot")
  }
  return output
}

private func encodedImage(_ image: CGImage, type: CFString, quality: Double? = nil) throws -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, type, 1, nil) else {
    throw HelperFailure(code: "encode_failed", message: "Could not create image encoder")
  }

  var properties: CFDictionary?
  if let quality {
    properties = [
      kCGImageDestinationLossyCompressionQuality: min(1, max(0, quality)),
    ] as CFDictionary
  }
  CGImageDestinationAddImage(destination, image, properties)
  guard CGImageDestinationFinalize(destination) else {
    throw HelperFailure(code: "encode_failed", message: "Could not encode screenshot")
  }
  return data as Data
}

private func capturedDisplayImage(_ displayID: CGDirectDisplayID) throws -> CGImage {
  try requireScreenRecordingPermission()
  guard let image = CGDisplayCreateImage(displayID) else {
    throw HelperFailure(
      code: "capture_failed",
      message: "Could not capture display \(displayID)"
    )
  }
  return image
}

private func capturedRegionImage(_ rect: CGRect) throws -> CGImage {
  try requireScreenRecordingPermission()
  guard rect.width > 0, rect.height > 0 else {
    throw HelperFailure(code: "invalid_region", message: "Capture region must be non-empty")
  }
  guard let image = CGWindowListCreateImage(
    rect,
    .optionOnScreenOnly,
    kCGNullWindowID,
    [.bestResolution]
  ) else {
    throw HelperFailure(code: "capture_failed", message: "Could not capture screen region")
  }
  return image
}

private func screenshotResult(_ payload: JSONObject, preferredKey: String) throws -> JSONObject {
  let display = try chooseDisplay(displayIdentifier(payload, preferredKey))
  guard let rawDisplayID = display["displayId"] as? Int else {
    throw HelperFailure(code: "display_error", message: "Display identifier is unavailable")
  }
  let displayID = CGDirectDisplayID(rawDisplayID)
  let rawImage = try capturedDisplayImage(displayID)
  let image = try resizedImage(
    rawImage,
    width: integer(payload, "targetWidth"),
    height: integer(payload, "targetHeight")
  )
  let quality = number(payload, "jpegQuality") ?? 0.75
  let data = try encodedImage(image, type: "public.jpeg" as CFString, quality: quality)

  return [
    "base64": data.base64EncodedString(),
    "width": image.width,
    "height": image.height,
    "displayWidth": display["width"] as? Int ?? rawImage.width,
    "displayHeight": display["height"] as? Int ?? rawImage.height,
    "displayId": rawDisplayID,
    "originX": display["originX"] as? Int ?? 0,
    "originY": display["originY"] as? Int ?? 0,
    "display": display,
  ]
}

private func zoomResult(_ payload: JSONObject) throws -> JSONObject {
  guard
    let x = number(payload, "x"),
    let y = number(payload, "y"),
    let width = number(payload, "width"),
    let height = number(payload, "height")
  else {
    throw HelperFailure(code: "invalid_region", message: "Zoom region is incomplete")
  }

  let rawImage = try capturedRegionImage(
    CGRect(x: x, y: y, width: width, height: height)
  )
  let image = try resizedImage(
    rawImage,
    width: integer(payload, "targetWidth"),
    height: integer(payload, "targetHeight")
  )
  let data = try encodedImage(image, type: "public.jpeg" as CFString, quality: 0.75)
  return [
    "base64": data.base64EncodedString(),
    "width": image.width,
    "height": image.height,
  ]
}

private func capturePNGToFile(_ payload: JSONObject) throws -> JSONObject {
  guard
    let x = number(payload, "x"),
    let y = number(payload, "y"),
    let width = number(payload, "width"),
    let height = number(payload, "height"),
    let outputPath = payload["outputPath"] as? String,
    !outputPath.isEmpty
  else {
    throw HelperFailure(code: "invalid_region", message: "PNG capture payload is incomplete")
  }

  let image = try capturedRegionImage(CGRect(x: x, y: y, width: width, height: height))
  let data = try encodedImage(image, type: "public.png" as CFString)
  try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
  return [
    "path": outputPath,
    "width": image.width,
    "height": image.height,
  ]
}

private func parsePayload() throws -> JSONObject {
  let arguments = CommandLine.arguments
  guard
    let payloadIndex = arguments.firstIndex(of: "--payload"),
    arguments.indices.contains(payloadIndex + 1)
  else {
    return [:]
  }
  guard let data = arguments[payloadIndex + 1].data(using: .utf8) else {
    throw HelperFailure(code: "invalid_payload", message: "Payload is not UTF-8")
  }
  guard let object = try JSONSerialization.jsonObject(with: data) as? JSONObject else {
    throw HelperFailure(code: "invalid_payload", message: "Payload must be a JSON object")
  }
  return object
}

@main
private enum CyberCodeComputerUse {
  static func main() {
    guard CommandLine.arguments.count >= 2 else {
      fail(HelperFailure(code: "missing_command", message: "A helper command is required"))
    }

    do {
      let command = CommandLine.arguments[1]
      let payload = try parsePayload()
      let result: Any

      switch command {
      case "check_screen_recording":
        result = ["screenRecording": CGPreflightScreenCaptureAccess()]
      case "request_screen_recording":
        let granted = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        result = ["screenRecording": granted || CGPreflightScreenCaptureAccess()]
      case "list_displays":
        result = try listDisplays()
      case "get_display_size":
        result = try chooseDisplay(displayIdentifier(payload, "displayId"))
      case "screenshot":
        result = try screenshotResult(payload, preferredKey: "displayId")
      case "resolve_prepare_capture":
        var capture = try screenshotResult(payload, preferredKey: "preferredDisplayId")
        capture["hidden"] = []
        capture["resolvedDisplayId"] = capture["displayId"]
        result = capture
      case "zoom":
        result = try zoomResult(payload)
      case "capture_png_to_file":
        result = try capturePNGToFile(payload)
      default:
        throw HelperFailure(
          code: "unknown_command",
          message: "Unknown Computer Use helper command: \(command)"
        )
      }

      writeEnvelope(["ok": true, "result": result])
    } catch let error as HelperFailure {
      fail(error)
    } catch {
      fail(HelperFailure(code: "runtime_error", message: error.localizedDescription))
    }
  }
}
