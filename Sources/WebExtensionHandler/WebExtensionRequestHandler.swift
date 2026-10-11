import Foundation
import BlockerCore
import SafariServices

@objc(ADVWebExtensionRequestHandler)
public final class WebExtensionRequestHandler: NSObject, NSExtensionRequestHandling {
    public func beginRequest(with context: NSExtensionContext) {
        var reply: [String: Any]
        do {
            guard let input = context.inputItems.first as? NSExtensionItem,
                  let message = input.userInfo?[SFExtensionMessageKey] as? [String: Any],
                  let operation = message["operation"] as? String else { throw PersonalRuleError.invalidRule }
            guard let store = PersonalRuleStore.configured() else {
                let item = NSExtensionItem()
                item.userInfo = [SFExtensionMessageKey: ["shared": false, "rules": []] as [String: Any]]
                context.completeRequest(returningItems: [item], completionHandler: nil)
                return
            }
            let rules: [PersonalRule]
            switch operation {
            case "list": rules = try store.read()
            case "merge":
                let data = try JSONSerialization.data(withJSONObject: message["rules"] ?? [])
                rules = try store.merge(JSONDecoder().decode([PersonalRule].self, from: data))
            case "add":
                guard let host = message["host"] as? String, let selector = message["selector"] as? String else { throw PersonalRuleError.invalidRule }
                rules = try store.merge([PersonalRule(host: host, selector: selector)])
            case "remove":
                guard let id = message["id"] as? String else { throw PersonalRuleError.invalidRule }
                rules = try store.remove(id: id)
            default: throw PersonalRuleError.invalidRule
            }
            reply = ["shared": true, "cloudConfigured": Bundle.main.object(forInfoDictionaryKey: "ADVCloudContainer") != nil,
                     "rules": try JSONSerialization.jsonObject(with: JSONEncoder().encode(rules))]
        } catch { reply = ["error": error.localizedDescription] }
        let item = NSExtensionItem()
        item.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
