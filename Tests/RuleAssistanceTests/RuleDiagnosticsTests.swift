import Foundation
import Testing
@testable import RuleAssistance

private func observations(_ json: String) throws -> [RuleObservation] {
    try JSONDecoder().decode([RuleObservation].self, from: Data(json.utf8))
}

@Test func duplicateAndDocumentOverlapAreDistinct() throws {
    let rows = try observations("""
    [{"selector":".ad","count":2,"matches":[0,1]},
     {"selector":".ad","count":2,"matches":[0,1]},
     {"selector":"div.ad","count":2,"matches":[1,0]},
     {"selector":".other","count":1,"matches":[2]}]
    """)
    let findings = RuleDiagnostics.inspect(rows)
    #expect(findings.count == 2)
    #expect(findings[0].message.contains("Duplicate"))
    #expect(findings[1].message.contains("this document only"))
}

@Test func incompleteSamplesDoNotProveEquivalence() throws {
    let rows = try observations("""
    [{"selector":".a","count":300,"matches":[0,1]},
     {"selector":".b","count":300,"matches":[0,1]}]
    """)
    #expect(RuleDiagnostics.inspect(rows).isEmpty)
}

@Test func missingAndGeneratedSelectorsAreOnlyEvidence() throws {
    let rows = try observations("""
    [{"selector":"#ad-123456789","count":0,"matches":[]},
     {"selector":"div:nth-of-type(3)","count":1,"matches":[0]},
     {"selector":"[broken","count":null,"matches":[]}]
    """)
    let findings = RuleDiagnostics.inspect(rows)
    #expect(findings.count == 4)
    #expect(findings.contains { $0.message.contains("other pages") })
    #expect(findings.filter { $0.message.contains("heuristic") }.count == 2)
    #expect(findings.contains { $0.message.contains("Invalid CSS") })
}

@Test func assistanceRejectsOversizedAndUnsafePayloads() throws {
    let request = try JSONDecoder().decode(AssistanceRequest.self, from: Data("""
    {"host":"example.com","question":"Help","candidates":[{"selector":".ad { display:none }","reason":"test","count":1}],"observations":[],"history":[]}
    """.utf8))
    #expect(throws: (any Error).self) { try RuleDiagnostics.validate(request) }
}

@Test func domainProposalsRequireLiteralHostnames() throws {
    for domain in ["ads.example.com", "https://ads.example.com", "ads.example.com/path", "ads..example.com"] {
        let json: [String: Any] = ["host":"example.com", "question":"Block the provider", "candidates":[["domain":domain, "selector":".ad", "reason":"Observed resource host", "count":1]], "observations":[], "history":[]]
        let request = try JSONDecoder().decode(AssistanceRequest.self, from: JSONSerialization.data(withJSONObject: json))
        if domain == "ads.example.com" { try RuleDiagnostics.validate(request) }
        else { #expect(throws: (any Error).self) { try RuleDiagnostics.validate(request) } }
    }
}
