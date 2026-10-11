import Foundation
import SafariStateBridge

enum SafariExtensionState {
    nonisolated static func enabled(identifier: String) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            ADVGetSafariExtensionEnabled(identifier) { enabled, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: enabled) }
            }
        }
    }
}
