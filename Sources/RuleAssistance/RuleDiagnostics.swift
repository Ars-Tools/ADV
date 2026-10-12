import Foundation

public struct RuleObservation: Codable, Sendable {
    public let selector: String
    public let count: Int?
    public let matches: [Int]
}

public struct RuleCandidate: Codable, Sendable {
    public let domain: String?
    public let label: String?
    public let selector: String
    public let reason: String
    public let count: Int?
}

public struct GuideTurn: Codable, Sendable {
    public let question: String
    public let answer: String
}

public struct AssistanceRequest: Codable, Sendable {
    public let host: String
    public let question: String
    public let candidates: [RuleCandidate]
    public let observations: [RuleObservation]
    public let history: [GuideTurn]
    public let phase: String?
}

public struct RuleFinding: Codable, Sendable, Equatable {
    public let selector: String
    public let message: String
}

public struct AssistanceReply: Codable, Sendable {
    public var explanation: String
    public let findings: [RuleFinding]
    public let candidates: [RuleCandidate]
    public var modelStatus: String
    public var suggestedIndex: Int?
    public var searchTerms: [String] = []
}

public enum RuleDiagnostics {
    public static func inspect(_ observations: [RuleObservation]) -> [RuleFinding] {
        var findings: [RuleFinding] = []
        var seen = Set<String>()
        var previous: [RuleObservation] = []
        for observation in observations {
            let selector = observation.selector
            if !seen.insert(selector).inserted {
                findings.append(.init(selector: selector, message: "Duplicate selector for this host."))
                continue
            }
            if observation.count == nil {
                findings.append(.init(selector: selector, message: "Invalid CSS syntax in this browser."))
            } else if observation.count == 0 {
                findings.append(.init(selector: selector, message: "No match in the inspected document. This does not prove the rule is unused on other pages or in frames."))
            }
            if selector.range(of: "(?:[a-fA-F0-9]{16,}|[0-9]{8,}|[a-fA-F0-9]{8}-[a-fA-F0-9-]{27,}|:nth-(?:of-type|child)\\()", options: .regularExpression) != nil {
                findings.append(.init(selector: selector, message: "Possibly generated or position-dependent selector. Check a stable class, attribute, or ID prefix; this is a heuristic."))
            }
            if let count = observation.count, count > 0, count == observation.matches.count {
                let matches = Set(observation.matches)
                if let other = previous.first(where: { $0.count == $0.matches.count && Set($0.matches) == matches }) {
                    findings.append(.init(selector: selector, message: "Matches the same elements as \(other.selector) in this document only. Review before removing either rule."))
                }
                previous.append(observation)
            }
        }
        return findings
    }

    public static func validate(_ request: AssistanceRequest) throws {
        guard request.host.count <= 253, !request.host.isEmpty,
              request.question.count <= 1500, request.candidates.count <= 12,
              request.phase.map({ ["interpret", "explain"].contains($0) }) ?? true,
              request.observations.count <= 80, request.history.count <= 4,
              request.candidates.allSatisfy({ validSelector($0.selector) && validDomain($0.domain) && $0.reason.count <= 200 && ($0.label.map { $0.count <= 120 } ?? true) && validCount($0.count) }),
              request.observations.allSatisfy({ validSelector($0.selector) && validCount($0.count) && $0.matches.count <= 200 && $0.matches.allSatisfy { $0 >= 0 } }),
              request.history.allSatisfy({ $0.question.count <= 1500 && $0.answer.count <= 1500 }) else {
            throw NSError(domain: "RuleAssistance", code: 1, userInfo: [NSLocalizedDescriptionKey: "The inspection is too large or invalid. Inspect a smaller selection."])
        }
    }

    private static func validCount(_ count: Int?) -> Bool { count.map { $0 >= 0 } ?? true }
    private static func validDomain(_ domain: String?) -> Bool {
        guard let domain else { return true }
        return domain.count <= 253 && domain.contains(".") && domain.split(separator: ".", omittingEmptySubsequences: false).allSatisfy {
            $0.range(of: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", options: .regularExpression) != nil
        }
    }
    private static func validSelector(_ selector: String) -> Bool {
        !selector.isEmpty && selector.count <= 2048 && selector.rangeOfCharacter(from: .controlCharacters) == nil &&
        !selector.contains("{") && !selector.contains("}") && !selector.contains("@")
    }
}
