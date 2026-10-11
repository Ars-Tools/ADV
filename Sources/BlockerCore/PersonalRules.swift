import Foundation
import Darwin

public struct PersonalRule: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var host: String
    public var selector: String
    public var modified: Double
    public var deleted: Bool

    public init(id: String = UUID().uuidString, host: String, selector: String,
                modified: Double = Date().timeIntervalSince1970 * 1000, deleted: Bool = false) throws {
        guard UUID(uuidString: id) != nil,
              !host.isEmpty, host.count <= 253,
              host.range(of: "^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$", options: .regularExpression) != nil,
              !host.contains(".."), !selector.isEmpty, selector.count <= 2048,
              selector.rangeOfCharacter(from: .controlCharacters) == nil,
              !selector.contains("{"), !selector.contains("}"), !selector.contains("@"),
              modified.isFinite, modified >= 0 else {
            throw PersonalRuleError.invalidRule
        }
        self.id = id; self.host = host; self.selector = selector
        self.modified = modified; self.deleted = deleted
    }

    public func validated() throws -> Self {
        try Self(id: id, host: host, selector: selector, modified: modified, deleted: deleted)
    }

}

public enum PersonalRuleError: LocalizedError {
    case invalidRule, tooLarge
    public var errorDescription: String? {
        switch self {
        case .invalidRule: "Invalid site or selector."
        case .tooLarge: "The personal rule collection exceeds the 500 KB limit."
        }
    }
}

public enum PersonalRules {
    // Keep tombstones so a device that was offline cannot resurrect a removed rule.
    public static func merge(_ left: [PersonalRule], _ right: [PersonalRule]) throws -> [PersonalRule] {
        var result: [String: PersonalRule] = [:]
        for value in left + right {
            let rule = try value.validated()
            if let old = result[rule.id] {
                // Equal timestamps resolve consistently on every device; deletion wins.
                let oldKey = "\(old.deleted)|\(old.host)|\(old.selector)"
                let newKey = "\(rule.deleted)|\(rule.host)|\(rule.selector)"
                if rule.modified < old.modified || (rule.modified == old.modified && newKey <= oldKey) { continue }
            }
            result[rule.id] = rule
        }
        let rules = result.values.sorted { $0.id < $1.id }
        guard try JSONEncoder().encode(rules).count <= 500_000 else { throw PersonalRuleError.tooLarge }
        return rules
    }
}

public struct PersonalRuleStore: Sendable {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }

    public static func configured(bundle: Bundle = .main) -> Self? {
        guard let group = bundle.object(forInfoDictionaryKey: "ADVAppGroup") as? String,
              let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return Self(directory: url.appendingPathComponent("ADV", isDirectory: true))
    }

    public func read() throws -> [PersonalRule] { try transaction { $0 } }
    @discardableResult
    public func merge(_ incoming: [PersonalRule]) throws -> [PersonalRule] {
        try transaction { try PersonalRules.merge($0, incoming) }
    }
    @discardableResult
    public func remove(id: String) throws -> [PersonalRule] {
        try transaction { rules in
            var rules = rules
            if let index = rules.firstIndex(where: { $0.id == id }) {
                rules[index].deleted = true
                rules[index].modified = max(Date().timeIntervalSince1970 * 1000, rules[index].modified + 1)
            }
            return rules
        }
    }

    private func transaction(_ update: ([PersonalRule]) throws -> [PersonalRule]) throws -> [PersonalRule] {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let lockURL = directory.appendingPathComponent("rules.lock")
        let fd = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { flock(fd, LOCK_UN) }
        let url = directory.appendingPathComponent("rules.json")
        let old = FileManager.default.fileExists(atPath: url.path)
            ? try JSONDecoder().decode([PersonalRule].self, from: Data(contentsOf: url)) : []
        let result = try PersonalRules.merge([], update(old))
        if result != old || !FileManager.default.fileExists(atPath: url.path) {
            try JSONEncoder().encode(result).write(to: url, options: .atomic)
        }
        return result
    }
}
