import BlockerCore
import CloudKit
import Foundation

// One known record avoids a query/index requirement. Optimistic saves merge conflicts.
@MainActor
enum CloudRuleSync {
    static func synchronize(store: PersonalRuleStore, containerID: String) async throws {
        let container = CKContainer(identifier: containerID)
        guard try await container.accountStatus() == .available else {
            throw NSError(domain: "ADV", code: 10, userInfo: [NSLocalizedDescriptionKey: "Sign in to iCloud and enable iCloud Drive to sync."])
        }
        let database = container.privateCloudDatabase
        let id = CKRecord.ID(recordName: "personal-rules-v1")
        for attempt in 0..<4 {
            let record: CKRecord
            do { record = try await database.record(for: id) }
            catch let error as CKError where error.code == .unknownItem {
                record = CKRecord(recordType: "ADVSettings", recordID: id)
            }
            let remote: [PersonalRule]
            if let data = record["rules"] as? Data {
                remote = try JSONDecoder().decode([PersonalRule].self, from: data)
            } else { remote = [] }
            let merged = try store.merge(remote)
            record["rules"] = try JSONEncoder().encode(merged) as CKRecordValue
            do {
                _ = try await database.save(record)
                // A picker may have written while the network save was in progress.
                if try store.read() == merged { return }
            } catch let error as CKError where error.code == .serverRecordChanged {
                if attempt == 3 { throw error }
            }
        }
        throw NSError(domain: "ADV", code: 11, userInfo: [NSLocalizedDescriptionKey: "Rules changed during sync. Please sync again."])
    }
}
