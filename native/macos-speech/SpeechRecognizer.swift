import Foundation
import Speech

struct Arguments {
    let audioPath: String
    let localeIdentifier: String
    let timeoutSeconds: TimeInterval
    let requiresOnDeviceRecognition: Bool
}

struct RecognitionOutput: Encodable {
    let text: String
}

enum HelperError: Error, CustomStringConvertible {
    case missingAudioPath
    case invalidTimeout(String)
    case unsupportedAuthorization(SFSpeechRecognizerAuthorizationStatus)
    case recognizerUnavailable(String)

    var description: String {
        switch self {
        case .missingAudioPath:
            return "缺少音频文件路径。"
        case .invalidTimeout(let value):
            return "timeout 参数无效：\(value)"
        case .unsupportedAuthorization(let status):
            return "macOS Speech 权限不可用：\(authorizationStatusName(status))"
        case .recognizerUnavailable(let locale):
            return "当前 macOS Speech recognizer 不可用：locale=\(locale)"
        }
    }
}

let arguments = parseArguments(CommandLine.arguments)

do {
    let output = try recognize(arguments)
    let encoded = try JSONEncoder().encode(output)
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}

func parseArguments(_ rawArguments: [String]) -> Arguments {
    var audioPath: String?
    var localeIdentifier = "zh-CN"
    var timeoutSeconds: TimeInterval = 12
    var requiresOnDeviceRecognition = false
    var index = 1

    while index < rawArguments.count {
        let argument = rawArguments[index]

        switch argument {
        case "--locale":
            index += 1
            if index < rawArguments.count {
                localeIdentifier = rawArguments[index]
            }
        case "--timeout":
            index += 1
            if index < rawArguments.count {
                guard let timeout = TimeInterval(rawArguments[index]), timeout > 0 else {
                    fail(HelperError.invalidTimeout(rawArguments[index]))
                }
                timeoutSeconds = timeout
            }
        case "--on-device":
            requiresOnDeviceRecognition = true
        default:
            if audioPath == nil {
                audioPath = argument
            }
        }

        index += 1
    }

    guard let audioPath else {
        fail(HelperError.missingAudioPath)
    }

    return Arguments(
        audioPath: audioPath,
        localeIdentifier: localeIdentifier,
        timeoutSeconds: timeoutSeconds,
        requiresOnDeviceRecognition: requiresOnDeviceRecognition
    )
}

func recognize(_ arguments: Arguments) throws -> RecognitionOutput {
    try requestSpeechAuthorization()

    let locale = Locale(identifier: arguments.localeIdentifier)
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
        throw HelperError.recognizerUnavailable(arguments.localeIdentifier)
    }

    let recognitionQueue = OperationQueue()
    recognitionQueue.name = "macos-speech-recognition"
    recognitionQueue.qualityOfService = .userInitiated
    recognizer.queue = recognitionQueue

    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: arguments.audioPath))
    request.shouldReportPartialResults = true

    if #available(macOS 13.0, *) {
        request.addsPunctuation = true
    }

    if arguments.requiresOnDeviceRecognition {
        request.requiresOnDeviceRecognition = true
    }

    final class RecognitionState {
        private let lock = NSLock()
        private var finished = false
        var text = ""
        var error: Error?

        func update(result: SFSpeechRecognitionResult?, error: Error?, semaphore: DispatchSemaphore) {
            lock.lock()
            defer { lock.unlock() }

            if let result {
                text = result.bestTranscription.formattedString
            }

            if let error {
                self.error = error
            }

            if !finished, error != nil || result?.isFinal == true {
                finished = true
                semaphore.signal()
            }
        }
    }

    let semaphore = DispatchSemaphore(value: 0)
    let state = RecognitionState()
    let task = recognizer.recognitionTask(with: request) { result, error in
        state.update(result: result, error: error, semaphore: semaphore)
    }

    let waitResult = semaphore.wait(timeout: .now() + arguments.timeoutSeconds)
    if waitResult == .timedOut {
        task.cancel()
    }

    let text = state.text.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty, let error = state.error {
        if isBenignNoSpeechError(error) {
            return RecognitionOutput(text: "")
        }
        throw error
    }

    return RecognitionOutput(text: text)
}

func isBenignNoSpeechError(_ error: Error) -> Bool {
    let nsError = error as NSError
    if nsError.domain == "kAFAssistantErrorDomain", nsError.code == 1110 {
        return true
    }

    return nsError.localizedDescription.localizedCaseInsensitiveContains("No speech detected")
}

func requestSpeechAuthorization() throws {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .authorized {
        return
    }

    let semaphore = DispatchSemaphore(value: 0)
    var requestedStatus = status

    SFSpeechRecognizer.requestAuthorization { status in
        requestedStatus = status
        semaphore.signal()
    }

    _ = semaphore.wait(timeout: .now() + 30)
    if requestedStatus != .authorized {
        throw HelperError.unsupportedAuthorization(requestedStatus)
    }
}

func fail(_ error: Error) -> Never {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}

func authorizationStatusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "notDetermined"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .authorized:
        return "authorized"
    @unknown default:
        return "unknown"
    }
}
