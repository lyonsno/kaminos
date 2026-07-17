import AppKit
import Foundation
import Network

private let nativeRoute = "kaminos.structural-material.native-trackpad-haptics.v0"
private let impulseSchema = "kaminos.structural-material.causal-haptic-impulse.v0"
private let receiptSchema = "kaminos.structural-material.native-haptic-receipt.v0"
private let causalHapticRoute = "kaminos.structural-material.causal-haptics.v0"
private let webGPUTearRoute = "kaminos.structural-material.webgpu-sympathetic-tear.v0"

private struct Configuration {
    var host = "127.0.0.1"
    var port: UInt16 = 8396
    var allowedOrigin = "http://127.0.0.1:8395"
    var dryRun = false

    static func parse(_ arguments: [String]) throws -> Configuration {
        var configuration = Configuration()
        var index = 1
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--host", "--port", "--allowed-origin":
                guard index + 1 < arguments.count else {
                    throw CompanionError.configuration("missing value for \(argument)")
                }
                let value = arguments[index + 1]
                if argument == "--host" {
                    configuration.host = value
                } else if argument == "--port" {
                    guard let port = UInt16(value), port > 0 else {
                        throw CompanionError.configuration("invalid port: \(value)")
                    }
                    configuration.port = port
                } else {
                    configuration.allowedOrigin = value
                }
                index += 2
            case "--dry-run":
                configuration.dryRun = true
                index += 1
            default:
                throw CompanionError.configuration("unknown argument: \(argument)")
            }
        }
        guard configuration.host == "127.0.0.1" || configuration.host == "::1" else {
            throw CompanionError.configuration("host must be a numeric loopback address")
        }
        guard let origin = URL(string: configuration.allowedOrigin),
              origin.scheme == "http" || origin.scheme == "https",
              origin.host == "127.0.0.1" || origin.host == "localhost" || origin.host == "::1",
              origin.path.isEmpty || origin.path == "/",
              origin.query == nil,
              origin.fragment == nil else {
            throw CompanionError.configuration("allowed origin must use a loopback host")
        }
        return configuration
    }
}

private enum CompanionError: Error, CustomStringConvertible {
    case configuration(String)
    case listener(String)

    var description: String {
        switch self {
        case .configuration(let message): return message
        case .listener(let message): return message
        }
    }
}

private struct CausalImpulse: Decodable {
    let schema: String
    let requestedRoute: String
    let effectiveRoute: String
    let cause: String
    let sourceRoute: String?
    let eventEpoch: Int?
    let newlyBrokenBondCount: Int
    let newlyBrokenDepthBondCount: Int
    let componentCountDelta: Int
    let interactionMagnitude: Double
    let intensity: Double
    let durationMs: Int
    let pattern: String

    func validationError() -> String? {
        if schema != impulseSchema { return "unexpected impulse schema" }
        if requestedRoute != causalHapticRoute || effectiveRoute != causalHapticRoute {
            return "impulse route is not the causal haptics route"
        }
        if cause != "accepted-gpu-connectivity-delta" { return "impulse lacks accepted GPU connectivity cause" }
        if sourceRoute != webGPUTearRoute { return "impulse source is not the WebGPU tear route" }
        if eventEpoch == nil || eventEpoch! < 0 { return "impulse lacks a valid event epoch" }
        if newlyBrokenBondCount <= 0 && componentCountDelta <= 0 { return "impulse has no connectivity delta" }
        if newlyBrokenBondCount < 0 || newlyBrokenDepthBondCount < 0 || componentCountDelta < 0 {
            return "connectivity counts must be nonnegative"
        }
        if !intensity.isFinite || intensity < 0 || intensity > 1 { return "intensity must be finite and within 0...1" }
        if durationMs < 0 { return "duration must be nonnegative" }
        if pattern != "crack" && pattern != "separation" { return "unsupported haptic pattern" }
        return nil
    }
}

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

private func jsonData(_ value: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
}

private final class ConnectionHandler: @unchecked Sendable {
    private let connection: NWConnection
    private let configuration: Configuration
    private let queue: DispatchQueue
    private var buffer = Data()

    init(connection: NWConnection, configuration: Configuration, queue: DispatchQueue) {
        self.connection = connection
        self.configuration = configuration
        self.queue = queue
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.connection.cancel() }
        }
        connection.start(queue: queue)
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [self] data, _, isComplete, error in
            if let data { self.buffer.append(data) }
            if let request = self.parseRequestIfComplete() {
                self.handle(request)
                return
            }
            if isComplete || error != nil {
                self.respond(status: 400, value: self.failure("http-request", "incomplete HTTP request"))
                return
            }
            self.receive()
        }
    }

    private func parseRequestIfComplete() -> HTTPRequest? {
        let delimiter = Data("\r\n\r\n".utf8)
        guard let headerRange = buffer.range(of: delimiter),
              let headerText = String(data: buffer[..<headerRange.lowerBound], encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let requestParts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard requestParts.count >= 2 else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let name = line[..<separator].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines)
            headers[name] = value
        }
        let contentLength = max(0, Int(headers["content-length"] ?? "0") ?? 0)
        let bodyStart = headerRange.upperBound
        guard bodyStart <= buffer.count, contentLength <= buffer.count - bodyStart else { return nil }
        return HTTPRequest(
            method: String(requestParts[0]),
            path: String(requestParts[1]),
            headers: headers,
            body: buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
        )
    }

    private func handle(_ request: HTTPRequest) {
        if request.method == "OPTIONS" {
            guard request.headers["origin"] == configuration.allowedOrigin else {
                respond(status: 403, value: failure("origin-validation", "origin is not allowed"))
                return
            }
            respond(status: 204, value: nil, includeCors: true)
            return
        }
        if request.method == "GET" && request.path == "/v1/capabilities" {
            respond(status: 200, value: capabilities(), includeCors: request.headers["origin"] == configuration.allowedOrigin)
            return
        }
        guard request.method == "POST" && request.path == "/v1/impulse" else {
            respond(status: 404, value: failure("route-resolution", "unknown companion route"))
            return
        }
        guard request.headers["origin"] == configuration.allowedOrigin else {
            respond(status: 403, value: failure("origin-validation", "origin is not allowed"))
            return
        }
        let impulse: CausalImpulse
        do {
            impulse = try JSONDecoder().decode(CausalImpulse.self, from: request.body)
        } catch {
            respond(status: 400, value: failure("impulse-decode", error.localizedDescription), includeCors: true)
            return
        }
        if let validationError = impulse.validationError() {
            respond(status: 422, value: failure("impulse-validation", validationError), includeCors: true)
            return
        }

        let performed: Bool
        if configuration.dryRun {
            performed = false
        } else {
            DispatchQueue.main.sync {
                let pattern: NSHapticFeedbackManager.FeedbackPattern = impulse.pattern == "separation" ? .levelChange : .generic
                NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
            }
            performed = true
        }
        respond(status: 200, value: [
            "schema": receiptSchema,
            "status": "passed",
            "requestedRoute": nativeRoute,
            "effectiveRoute": nativeRoute,
            "cause": impulse.cause,
            "sourceRoute": impulse.sourceRoute ?? NSNull(),
            "eventEpoch": impulse.eventEpoch ?? NSNull(),
            "pattern": impulse.pattern,
            "performed": performed,
            "dryRun": configuration.dryRun,
            "tactileOutputVerified": false,
            "tactileOutputQualification": "AppKit perform() has no physical-output acknowledgement; macOS may suppress feedback",
        ], includeCors: true)
    }

    private func capabilities() -> [String: Any] {
        [
            "schema": "kaminos.structural-material.native-haptic-capabilities.v0",
            "status": "passed",
            "requestedRoute": nativeRoute,
            "effectiveRoute": nativeRoute,
            "host": configuration.host,
            "port": configuration.port,
            "allowedOrigin": configuration.allowedOrigin,
            "loopbackOnly": true,
            "actuator": "AppKit.NSHapticFeedbackManager.defaultPerformer",
            "dryRun": configuration.dryRun,
            "structuralAuthority": false,
        ]
    }

    private func failure(_ phase: String, _ message: String) -> [String: Any] {
        [
            "schema": receiptSchema,
            "status": "failed",
            "requestedRoute": nativeRoute,
            "effectiveRoute": nativeRoute,
            "failurePhase": phase,
            "error": message,
            "performed": false,
            "tactileOutputVerified": false,
        ]
    }

    private func respond(status: Int, value: [String: Any]?, includeCors: Bool = false) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 204: reason = "No Content"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 422: reason = "Unprocessable Content"
        default: reason = "Error"
        }
        let body = value.map(jsonData) ?? Data()
        var headers = [
            "HTTP/1.1 \(status) \(reason)",
            "Content-Type: application/json; charset=utf-8",
            "Content-Length: \(body.count)",
            "Connection: close",
        ]
        if includeCors {
            headers.append("Access-Control-Allow-Origin: \(configuration.allowedOrigin)")
            headers.append("Access-Control-Allow-Methods: GET, POST, OPTIONS")
            headers.append("Access-Control-Allow-Headers: Content-Type")
            headers.append("Vary: Origin")
        }
        let head = Data((headers.joined(separator: "\r\n") + "\r\n\r\n").utf8)
        connection.send(content: head + body, completion: .contentProcessed { [connection] _ in connection.cancel() })
    }
}

private final class CompanionServer: @unchecked Sendable {
    private let configuration: Configuration
    private let queue = DispatchQueue(label: "kaminos.structural-material.native-haptics")
    private let listener: NWListener

    init(configuration: Configuration) throws {
        self.configuration = configuration
        let parameters = NWParameters.tcp
        guard let port = NWEndpoint.Port(rawValue: configuration.port) else {
            throw CompanionError.configuration("invalid listener port")
        }
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(configuration.host), port: port)
        do {
            listener = try NWListener(using: parameters)
        } catch {
            throw CompanionError.listener(error.localizedDescription)
        }
    }

    func run() {
        listener.stateUpdateHandler = { [configuration] state in
            switch state {
            case .ready:
                let receipt: [String: Any] = [
                    "schema": "kaminos.structural-material.native-haptic-listener.v0",
                    "status": "listening",
                    "requestedRoute": nativeRoute,
                    "effectiveRoute": nativeRoute,
                    "host": configuration.host,
                    "port": configuration.port,
                    "allowedOrigin": configuration.allowedOrigin,
                    "dryRun": configuration.dryRun,
                ]
                FileHandle.standardOutput.write(jsonData(receipt) + Data("\n".utf8))
            case .failed(let error):
                let receipt: [String: Any] = [
                    "schema": "kaminos.structural-material.native-haptic-listener.v0",
                    "status": "failed",
                    "requestedRoute": nativeRoute,
                    "effectiveRoute": nativeRoute,
                    "failurePhase": "listener-runtime",
                    "error": error.localizedDescription,
                ]
                FileHandle.standardError.write(jsonData(receipt) + Data("\n".utf8))
                exit(1)
            default:
                break
            }
        }
        listener.newConnectionHandler = { [configuration, queue] connection in
            ConnectionHandler(connection: connection, configuration: configuration, queue: queue).start()
        }
        listener.start(queue: queue)
        RunLoop.main.run()
    }
}

do {
    let configuration = try Configuration.parse(CommandLine.arguments)
    _ = NSApplication.shared
    try CompanionServer(configuration: configuration).run()
} catch {
    let receipt: [String: Any] = [
        "schema": "kaminos.structural-material.native-haptic-listener.v0",
        "status": "failed",
        "requestedRoute": nativeRoute,
        "effectiveRoute": NSNull(),
        "failurePhase": "configuration-or-listener-initialization",
        "error": String(describing: error),
    ]
    FileHandle.standardError.write(jsonData(receipt) + Data("\n".utf8))
    exit(2)
}
