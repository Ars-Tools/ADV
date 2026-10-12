import BlockerCore
import Foundation
#if os(macOS)
import AppKit
import WebKit

// Only the WebKit harness needs Apple's Content Blocker representation.
private struct ContentRule: Encodable {
    struct Trigger: Encodable {
        let urlFilter: String
        let resourceType: [String]
        let ifDomain: [String]?
        enum CodingKeys: String, CodingKey {
            case urlFilter = "url-filter", resourceType = "resource-type", ifDomain = "if-domain"
        }
    }
    struct Action: Encodable { let type: String }
    let trigger: Trigger
    let action: Action

    init(_ rule: NetworkRule) {
        let types = ["stylesheet": "style-sheet", "xmlhttprequest": "raw", "other": "raw"]
        trigger = .init(urlFilter: rule.condition.regexFilter,
                        resourceType: rule.condition.resourceTypes.map { types[$0] ?? $0 },
                        ifDomain: rule.condition.requestDomains)
        action = .init(type: rule.action.type)
    }
}

struct PageResult: Decodable {
    let normalScript: Bool
    let adScript: Bool
    let adImage: Bool
    let adHidden: Bool
    let contentVisible: Bool
}

@MainActor
final class PageProbe: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private var completion: CheckedContinuation<Void, any Error>?

    init(ruleList: WKContentRuleList?) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if let ruleList { configuration.userContentController.add(ruleList) }
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
        super.init()
        webView.navigationDelegate = self
    }

    func inspect(_ url: URL) async throws -> PageResult {
        try await load(url)
        let script = """
        JSON.stringify({
          normalScript: window.normalScriptLoaded === true,
          adScript: window.adScriptLoaded === true,
          adImage: document.querySelector('#ad-image').naturalWidth > 0,
          adHidden: getComputedStyle(document.querySelector('#adv-demo-ad')).display === 'none',
          contentVisible: getComputedStyle(document.querySelector('#normal-content')).display !== 'none'
        })
        """
        guard let json = try await webView.evaluateJavaScript(script) as? String else {
            throw NSError(domain: "ADVCheck", code: 1)
        }
        return try JSONDecoder().decode(PageResult.self, from: Data(json.utf8))
    }

    func verifyYouTube(_ url: URL, resourceDirectory: URL) async throws {
        try await load(url)
        let script = try String(contentsOf: resourceDirectory.appendingPathComponent("youtube.js"), encoding: .utf8)
        let css = try String(contentsOf: resourceDirectory.appendingPathComponent("youtube.css"), encoding: .utf8)
        _ = try await runJavaScript(
            "const style = document.createElement('style'); style.textContent = css; document.head.append(style); return 'ready';",
            arguments: ["css": css]
        )
        _ = try await webView.evaluateJavaScript(script)
        let json = try await runJavaScript("return await window.runADVYouTubeTests();", arguments: [:])
        let results = try JSONDecoder().decode([String].self, from: Data(json.utf8))
        guard results.count == 10 else { throw NSError(domain: "ADVCheck", code: 6) }
        for result in results { print("PASS: \(result).") }
    }

    private func runJavaScript(_ script: String, arguments: [String: Any]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    if let value = value as? String { continuation.resume(returning: value) }
                    else { continuation.resume(throwing: NSError(domain: "ADVCheck", code: 5)) }
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }

    func verifyPersonal(_ url: URL, resourceDirectory: URL) async throws {
        try await load(url)
        let background = try String(contentsOf: resourceDirectory.appendingPathComponent("background.js"), encoding: .utf8)
        let personal = try String(contentsOf: resourceDirectory.appendingPathComponent("personal.js"), encoding: .utf8)
        let picker = try String(contentsOf: resourceDirectory.appendingPathComponent("picker.js"), encoding: .utf8)
        let css = try String(contentsOf: resourceDirectory.appendingPathComponent("builtin.css"), encoding: .utf8)
        _ = try await runJavaScript("const style = document.createElement('style'); style.textContent = css; document.head.append(style); return 'ready';", arguments: ["css": css])
        _ = try await webView.evaluateJavaScript(background + "\n;void 0;")
        let json = try await runJavaScript("return await window.runADVPersonalTests(personal, picker, background);", arguments: ["personal": personal, "picker": picker, "background": background])
        let results = try JSONDecoder().decode([String].self, from: Data(json.utf8))
        guard results.count == 44 else { throw NSError(domain: "ADVCheck", code: 7) }
        for result in results { print("PASS: \(result).") }
        let sourceJSON = try await runJavaScript("return await window.runADVSourceTests(picker, background);", arguments: ["picker": picker, "background": background])
        let sourceResults = try JSONDecoder().decode([String].self, from: Data(sourceJSON.utf8))
        guard sourceResults.count == 14 else { throw NSError(domain: "ADVCheck", code: 9) }
        for result in sourceResults { print("PASS: \(result).") }
        let toolbarJSON = try await runJavaScript("return await window.runADVToolbarTests();", arguments: [:])
        let toolbarResults = try JSONDecoder().decode([String].self, from: Data(toolbarJSON.utf8))
        guard toolbarResults.count == 9 else { throw NSError(domain: "ADVCheck", code: 11) }
        for result in toolbarResults { print("PASS: \(result).") }
        let help = try String(contentsOf: resourceDirectory.appendingPathComponent("help.js"), encoding: .utf8)
        let helpJSON = try await runJavaScript("return await window.runADVHelpTests(help);", arguments: ["help": help])
        let helpResults = try JSONDecoder().decode([String].self, from: Data(helpJSON.utf8))
        guard helpResults.count == 20 else { throw NSError(domain: "ADVCheck", code: 12) }
        for result in helpResults { print("PASS: \(result).") }
        let popupScript = try String(contentsOf: resourceDirectory.appendingPathComponent("popup.js"), encoding: .utf8)
        let popupHTML = try String(contentsOf: resourceDirectory.appendingPathComponent("popup.html"), encoding: .utf8)
        let controlsJSON = try await runJavaScript("return await window.runADVWorkspaceControls(help,popup,html);", arguments: ["help":help,"popup":popupScript,"html":popupHTML])
        let controls = try JSONDecoder().decode([String].self, from: Data(controlsJSON.utf8))
        guard controls.count == 7 else { throw NSError(domain:"ADVCheck",code:14) }
        for result in controls { print("PASS: \(result).") }


    }

    func verifyPopup(resourceDirectory: URL) async throws {
        // Start narrower than the popup: Safari initially measures an undersized
        // web view before resizing its popover to the document's intrinsic size.
        for width in [64.0, 340.0] {
            webView.frame.size = NSSize(width: width, height: 600)
            try await load(resourceDirectory.appendingPathComponent("popup.html"))
            let valid = try await webView.evaluateJavaScript("""
            (() => {
              const body = document.body.getBoundingClientRect();
              const root = document.documentElement.getBoundingClientRect();
              return body.width === 340 && root.width === 340 &&
                document.body.clientHeight === 600 && getComputedStyle(document.body).overflowY === 'auto' &&
                document.querySelector('#site').getBoundingClientRect().width >= 290 &&
                document.querySelector('#pick').getBoundingClientRect().width >= 290 &&
                document.querySelector('h1').getBoundingClientRect().right <= body.right &&
                document.querySelector('.mark').getBoundingClientRect().right <= body.right;
            })()
            """) as? Bool
            guard valid == true else {
                throw NSError(domain: "ADVCheck", code: 8, userInfo: [NSLocalizedDescriptionKey: "Popup collapsed at viewport width \(width)."])
            }
            print("PASS: Popup retains readable width in a \(Int(width))px initial viewport.")
        }
    }

    func verifyWorkspace(resourceDirectory: URL) async throws {
        var components = URLComponents(url: resourceDirectory.appendingPathComponent("popup.html"), resolvingAgainstBaseURL: false)!
        components.query = "workspace=1&tabId=1"
        for width in [1200.0, 390.0] {
            webView.frame.size = NSSize(width: width, height: 800)
            try await load(components.url!)
            let valid = try await webView.evaluateJavaScript("""
            (() => {
                const help = document.querySelector('#help').getBoundingClientRect();
                const draft = document.querySelector('#draft-panel').getBoundingClientRect();
                const saved = document.querySelector('#saved-panel').getBoundingClientRect();
                const wide = window.innerWidth > 980;
                return document.documentElement.classList.contains('workspace') &&
                  document.body.scrollWidth <= window.innerWidth &&
                  (wide ? draft.left < saved.left && saved.left < help.left
                        : help.top < draft.top && draft.top < saved.top);
            })()
            """) as? Bool
            guard valid == true else { throw NSError(domain: "ADVCheck", code: 13, userInfo: [NSLocalizedDescriptionKey: "Workspace layout failed at \(width)px."] ) }
            print("PASS: Workspace keeps draft, saved rules, and conversation readable at \(Int(width))px.")
        }
    }

    private func load(_ url: URL) async throws {
        try await withCheckedThrowingContinuation { continuation in
            completion = continuation
            if url.isFileURL {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            } else {
                webView.load(URLRequest(url: url))
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(20))
                guard completion != nil else { return }
                webView.stopLoading()
                finish(URLError(.timedOut))
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish(nil) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) { finish(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { finish(error) }

    private func finish(_ error: (any Error)?) {
        guard let continuation = completion else { return }
        completion = nil
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume() }
    }
}

@main
enum ADVCheck {
    @MainActor static func main() async {
        let args = CommandLine.arguments
        if args.dropFirst().first == "export" {
            do {
                guard args.count <= 3 else { throw NSError(domain: "ADVCheck", code: 10, userInfo: [NSLocalizedDescriptionKey: "Usage: ADVCheck export [output.json]"]) }
                let data = try NetworkRules.json()
                if args.count == 3 {
                    try data.write(to: URL(fileURLWithPath: args[2]), options: .atomic)
                    print("Exported \(NetworkRules.all.count) declarative network rules.")
                } else { FileHandle.standardOutput.write(data) }
            } catch {
                FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8)); exit(1)
            }
            return
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let identifier = "local.adv.integration.\(UUID().uuidString)"
        do {
            let data = args.count > 2 ? try Data(contentsOf: URL(fileURLWithPath: args[2])) : try NetworkRules.json()
            let networkRules = try JSONDecoder().decode([NetworkRule].self, from: data)
            let json = try JSONEncoder().encode(networkRules.map(ContentRule.init))
            let url = URL(string: args.count > 1 ? args[1] : "http://127.0.0.1:8765/")!
            let ruleList = try await WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: identifier, encodedContentRuleList: String(decoding: json, as: UTF8.self)
            )
            guard let ruleList else { throw NSError(domain: "ADVCheck", code: 2) }
            print("PASS: Packaged DNR rules translate to valid WebKit block rules (DNR installation is a separate Safari check).")
            let baseline = try await PageProbe(ruleList: nil).inspect(url)
            guard baseline.normalScript && baseline.adScript && baseline.adImage && !baseline.adHidden && baseline.contentVisible else {
                throw NSError(domain: "ADVCheck", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unfiltered baseline failed."])
            }
            print("PASS: Without rules, both ad resources load and the ad is visible.")
            let filtered = try await PageProbe(ruleList: ruleList).inspect(url)
            guard filtered.normalScript && !filtered.adScript && !filtered.adImage && !filtered.adHidden && filtered.contentVisible else {
                throw NSError(domain: "ADVCheck", code: 4, userInfo: [NSLocalizedDescriptionKey: "Filtering did not match the expected DOM/resource state."])
            }
            print("PASS: Network rules block ad script/image while normal content remains intact.")
            let youtubeResources = URL(fileURLWithPath: args.count > 3 ? args[3] : "WebExtension", isDirectory: true)
            try await PageProbe(ruleList: nil).verifyYouTube(url.appendingPathComponent("youtube-test"), resourceDirectory: youtubeResources)
            try await PageProbe(ruleList: nil).verifyPersonal(url.appendingPathComponent("personal-test"), resourceDirectory: youtubeResources)
            try await PageProbe(ruleList: nil).verifyPopup(resourceDirectory: youtubeResources.standardizedFileURL)
            try await PageProbe(ruleList: nil).verifyWorkspace(resourceDirectory: youtubeResources.standardizedFileURL)
            try await WKContentRuleListStore.default().removeContentRuleList(forIdentifier: identifier)
        } catch {
            try? await WKContentRuleListStore.default().removeContentRuleList(forIdentifier: identifier)
            FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8))
            exit(1)
        }
    }
}
#else
@main enum ADVCheck {
    static func main() { print("Run ADVCheck on macOS to verify WebKit filtering.") }
}
#endif
