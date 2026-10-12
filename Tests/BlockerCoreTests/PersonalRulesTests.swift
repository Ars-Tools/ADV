import BlockerCore
import Foundation
import Testing

@Test func offlineAdditionsAndDeletionConverge() throws {
    let a = try PersonalRule(host: "example.com", selector: "#ad", modified: 10)
    let b = try PersonalRule(host: "other.example.com", selector: ".promo", modified: 20)
    var deleted = a; deleted.deleted = true; deleted.modified = 30
    let first = try PersonalRules.merge([a, b], [deleted])
    let second = try PersonalRules.merge([deleted], [b, a])
    #expect(first == second)
    #expect(first.filter { !$0.deleted } == [b])
    #expect(try PersonalRules.merge(first, [a]) == first)
    var tie = a; tie.deleted = true
    #expect(try PersonalRules.merge([a], [tie]).first?.deleted == true)
    #expect(try PersonalRules.merge([tie], [a]).first?.deleted == true)
}

@Test func scopeValidationAndSharedPersistence() throws {
    #expect(throws: PersonalRuleError.self) { try PersonalRule(host: "example.com/path", selector: "#ad") }
    #expect(throws: PersonalRuleError.self) { try PersonalRule(host: "example.com", selector: "x}body{display:none") }
    let rule = try PersonalRule(host: "example.com", selector: "#ad")
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = PersonalRuleStore(directory: directory)
    let second = PersonalRuleStore(directory: directory)
    try first.merge([rule])
    #expect(try second.read() == [rule])
    try second.remove(id: rule.id)
    try first.merge([rule])
    #expect(try first.read().first?.deleted == true)
}

@Test func concurrentWritersKeepEveryAddition() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let rules = try (0..<24).map { try PersonalRule(host: "example.com", selector: "#ad-\($0)") }
    try await withThrowingTaskGroup(of: Void.self) { group in
        for rule in rules {
            group.addTask { try PersonalRuleStore(directory: directory).merge([rule]) }
        }
        try await group.waitForAll()
    }
    let stored = try PersonalRuleStore(directory: directory).read()
    #expect(Set(stored.map(\.id)) == Set(rules.map(\.id)))
}

@Test func replacementRejectsConcurrentUpdatesAndDeletion() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = PersonalRuleStore(directory: directory)
    let old = try PersonalRule(host: "example.com", selector: ".old", modified: 10)
    try store.merge([old])
    var remote = old; remote.selector = ".remote"; remote.modified = 20
    try store.merge([remote])
    #expect(throws: PersonalRuleError.self) {
        try store.replace(id: old.id, host: old.host, selector: ".stale", expectedModified: old.modified)
    }
    #expect(try store.read() == [remote])
    let edited = try store.replace(id: old.id, host: old.host, selector: ".edited", expectedModified: remote.modified)[0]
    #expect(edited.id == old.id && edited.selector == ".edited" && edited.modified > remote.modified)
    try store.remove(id: old.id)
    #expect(throws: PersonalRuleError.self) {
        try store.replace(id: old.id, host: old.host, selector: ".resurrected", expectedModified: edited.modified)
    }
    #expect(try store.read()[0].deleted)
}
