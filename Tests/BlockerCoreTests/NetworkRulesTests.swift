import BlockerCore
import Foundation
import Testing

@Test func declarativeRulesPreserveNetworkScope() throws {
    let rules = try JSONDecoder().decode([NetworkRule].self, from: NetworkRules.json())
    #expect(rules.count == 14)
    #expect(rules.map(\.id) == Array(1...14))
    #expect(rules.allSatisfy { $0.action.type == "block" && $0.priority == 1 })
    #expect(rules.allSatisfy { !$0.condition.resourceTypes.contains("main_frame") && !$0.condition.resourceTypes.contains("popup") })
    #expect(rules[0].condition.resourceTypes.contains("stylesheet"))
    #expect(rules[0].condition.resourceTypes.contains("xmlhttprequest"))
    #expect(rules[0].condition.resourceTypes == ["image", "stylesheet", "script", "font", "xmlhttprequest", "media", "other"])
    for rule in rules.suffix(2) { #expect(rule.condition.requestDomains == ["localhost", "127.0.0.1"]) }
    let regex = try NSRegularExpression(pattern: rules[0].condition.regexFilter)
    let valid = "https://ads.doubleclick.net/ad.js"
    let invalid = "https://doubleclick.net.example.org/ad.js"
    #expect(regex.firstMatch(in: valid, range: NSRange(valid.startIndex..., in: valid)) != nil)
    #expect(regex.firstMatch(in: invalid, range: NSRange(invalid.startIndex..., in: invalid)) == nil)
}

@Test func domainBoundaries() throws {
    let regex = try NSRegularExpression(pattern: NetworkRules.domainFilter("doubleclick.net"))
    func matches(_ url: String) -> Bool {
        regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)) != nil
    }
    #expect(matches("https://doubleclick.net/ad.js"))
    #expect(matches("https://a.b.doubleclick.net:443/ad.js"))
    #expect(!matches("https://notdoubleclick.net/ad.js"))
    #expect(!matches("https://doubleclick.net.example.org/ad.js"))
    #expect(!matches("https://example.org/doubleclick.net/ad.js"))
}
