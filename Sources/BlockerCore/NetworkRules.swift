import Foundation

public struct NetworkRule: Codable, Sendable {
    public struct Action: Codable, Sendable { public var type: String }
    public struct Condition: Codable, Sendable {
        public var regexFilter: String
        public var resourceTypes: [String]
        public var requestDomains: [String]?
    }
    public var id: Int
    public var priority: Int
    public var action: Action
    public var condition: Condition

}

public enum NetworkRules {
    public static let blockedDomains = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "adservice.google.com", "amazon-adsystem.com", "adnxs.com",
        "adsrvr.org", "criteo.com", "criteo.net", "taboola.com",
        "outbrain.com", "smartadserver.com",
    ]

    public static func domainFilter(_ domain: String) -> String {
        "^https?://([^/]+\\.)?" + domain.replacingOccurrences(of: ".", with: "\\.") + "(:[0-9]+)?/"
    }

    public static var all: [NetworkRule] {
        var rules = blockedDomains.enumerated().map { index, domain in
            NetworkRule(id: index + 1, priority: 1, action: .init(type: "block"),
                        condition: .init(regexFilter: domainFilter(domain),
                                         resourceTypes: ["image", "stylesheet", "script", "font", "xmlhttprequest", "media", "other"]))
        }
        for suffix in ["js", "svg"] {
            rules.append(.init(id: rules.count + 1, priority: 1, action: .init(type: "block"),
                               condition: .init(regexFilter: "/adv-demo/blocked\\." + suffix + "$",
                                                resourceTypes: ["script", "image"],
                                                requestDomains: ["localhost", "127.0.0.1"])))
        }
        return rules
    }
    public static func json() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(all)
    }
}
