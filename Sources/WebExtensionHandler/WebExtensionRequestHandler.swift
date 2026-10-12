import Foundation
import BlockerCore
import SafariServices
import RuleAssistance

@objc(ADVWebExtensionRequestHandler)
public final class WebExtensionRequestHandler: NSObject, NSExtensionRequestHandling {
    public func beginRequest(with context: NSExtensionContext) {
        var reply: [String: Any]
        do {
            guard let input = context.inputItems.first as? NSExtensionItem,
                  let message = input.userInfo?[SFExtensionMessageKey] as? [String: Any],
                  let operation = message["operation"] as? String else { throw PersonalRuleError.invalidRule }
            if operation == "assist" {
                let data = try JSONSerialization.data(withJSONObject: message["request"] ?? [:])
                let request = try JSONDecoder().decode(AssistanceRequest.self, from: data)
                let completion = AssistanceCompletion(context: context)
                Task { @MainActor in
                    let response: [String: Any]
                    do {
                        let report = try await FoundationModelsGuide.respond(to: request)
                        response = try JSONSerialization.jsonObject(with: JSONEncoder().encode(report)) as! [String: Any]
                    } catch { response = ["error": error.localizedDescription] }
                    completion.reply(response)
                }
                return
            }
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

// Ownership is transferred to one asynchronous task; the request context is
// never accessed by the synchronous handler again on this branch.
private struct AssistanceCompletion: @unchecked Sendable {
    let context: NSExtensionContext
    func reply(_ response: [String: Any]) {
        let item = NSExtensionItem()
        item.userInfo = [SFExtensionMessageKey: response]
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
