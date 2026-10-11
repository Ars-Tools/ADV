import BlockerCore
import SafariServices
import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct ADVApp: App {
    var body: some Scene {
        WindowGroup("ADV") {
            BlockerView()
                #if os(macOS)
                .frame(width: 540, height: 740)
                #endif
        }
        #if os(macOS)
        .windowResizability(.contentSize)
        #endif
    }
}

struct BlockerView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var status = "Checking Safari…"
    @State private var isBusy = false
    @State private var personalCount = 0
    @State private var syncStatus = "iCloud sync is not configured. Safari saves personal rules locally."

    private var cloudID: String? { Bundle.main.object(forInfoDictionaryKey: "ADVCloudContainer") as? String }

    private var extensionID: String {
        (Bundle.main.bundleIdentifier ?? "local.adv") + ".YouTube"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("PERSONAL SAFARI FILTER")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .tracking(2)
                        Text("ADV")
                            .font(.system(size: 72, weight: .black))
                            .tracking(-4)
                            .accessibilityAddTraits(.isHeader)
                        Text("Less noise.\nMore space.")
                            .font(.title2.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    BauhausMark()
                        .frame(width: 112, height: 144)
                        .accessibilityHidden(true)
                }
                .padding(.bottom, 24)

                HStack(spacing: 0) {
                    metric("\(NetworkRules.blockedDomains.count)", label: "AD DOMAINS", color: Bauhaus.yellow)
                    metric("\(NetworkRules.all.count)", label: "NETWORK RULES", color: Bauhaus.paper)
                }
                .overlay(Rectangle().strokeBorder(Bauhaus.ink, lineWidth: 2))
                .padding(.bottom, 24)

                section("01", title: "Safari", color: Bauhaus.red) {
                    Text(status).textSelection(.enabled)
                    #if os(macOS)
                    Text("Enable ADV in Safari → Settings → Extensions. Allow ADV on your chosen sites.")
                        .foregroundStyle(Bauhaus.secondary)
                    #else
                    Text("Enable ADV in Settings → Apps → Safari → Extensions. On iOS 16–17, use Settings → Safari. Allow access on your chosen sites.")
                        .foregroundStyle(Bauhaus.secondary)
                    #endif
                    HStack(spacing: 10) {
                        Button("Check status") { Task { await refresh() } }
                            .buttonStyle(BauhausButtonStyle())
                        Button("Safari settings ↗") { Task { await openSettings() } }
                            .buttonStyle(BauhausButtonStyle(fill: Bauhaus.ink, foreground: Bauhaus.paper))
                    }
                    .disabled(isBusy)
                }

                section("02", title: "Personal filters", color: Bauhaus.blue) {
                    Text("In Safari, open ADV → Pick elements to hide. Select several elements, review the list, then save them together.")
                    Text(PersonalRuleStore.configured() == nil ? "Saved in your Safari profile. App sharing requires a signed App Group." : "\(personalCount) personal rules shared with Safari.")
                        .foregroundStyle(Bauhaus.secondary)
                }

                section("03", title: "Across devices", color: Bauhaus.yellow) {
                    Text(syncStatus).textSelection(.enabled)
                    Button("Sync iCloud now") { Task { await synchronize() } }
                        .buttonStyle(BauhausButtonStyle(fill: Bauhaus.blue, foreground: .white))
                        .disabled(isBusy || cloudID == nil || PersonalRuleStore.configured() == nil)
                    Text("Open ADV on each device to exchange rules. Reload Safari pages after syncing.")
                        .foregroundStyle(Bauhaus.secondary)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("YOUTUBE · EXPERIMENTAL")
                        .font(.system(size: 10, weight: .bold, design: .monospaced)).tracking(1.5)
                    Text("Hides display ads and attempts to skip or shorten video ads. Some ads may remain.")
                        .font(.caption).foregroundStyle(Bauhaus.secondary)
                    #if os(macOS)
                    Button("Open filter test ↗") {
                        guard let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") else { return }
                        NSWorkspace.shared.open(
                            [URL(string: "http://127.0.0.1:8765/")!],
                            withApplicationAt: safari,
                            configuration: NSWorkspace.OpenConfiguration()
                        )
                    }
                    .buttonStyle(BauhausButtonStyle())
                    Text("Start the local test server before opening the test page.")
                        .font(.caption).foregroundStyle(Bauhaus.secondary)
                    #endif
                }
                .padding(.top, 20)
            }
            .padding(28)
        }
        .background(Bauhaus.paper)
        .foregroundStyle(Bauhaus.ink)
        .preferredColorScheme(.light)
        .task { await refresh(); await synchronize() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await refresh(); await synchronize() } }
        }
    }

    private func metric(_ value: String, label: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(value).font(.system(size: 26, weight: .black))
            Text(label).font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(0.5)
        }
        .frame(maxWidth: .infinity, minHeight: 54)
        .background(color)
    }

    private func section<Content: View>(_ number: String, title: String, color: Color,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Rectangle().fill(Bauhaus.ink).frame(height: 2)
            HStack(spacing: 12) {
                Text(number)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(number == "03" ? Bauhaus.ink : .white)
                    .frame(width: 30, height: 30)
                    .background(color)
                    .accessibilityHidden(true)
                Text(title).font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
            }
            VStack(alignment: .leading, spacing: 10) { content() }
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 20)
        }
    }

    @MainActor
    private func refresh() async {
        isBusy = true
        defer { isBusy = false }
        do {
            if let store = PersonalRuleStore.configured() {
                personalCount = try store.read().filter { !$0.deleted }.count
            }
            #if os(macOS)
            let enabled = try await SafariExtensionState.enabled(identifier: extensionID)
            status = enabled ? "ADV extension: enabled in Safari." : "ADV extension: not enabled in Safari."
            #else
            if #available(iOS 26.2, *) {
                let state = try await SFSafariExtensionManager.stateOfExtension(withIdentifier: extensionID)
                status = state.isEnabled ? "ADV extension: enabled in Safari." : "ADV extension: not enabled in Safari."
            } else {
                status = "Check ADV in Settings → Safari → Extensions. Automatic status checks require iOS 26.2 or later."
            }
            #endif
        } catch {
            status = "Could not check the Safari extension: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func synchronize() async {
        guard !isBusy, let id = cloudID, let store = PersonalRuleStore.configured() else { return }
        isBusy = true
        syncStatus = "Syncing personal rules with iCloud…"
        defer { isBusy = false }
        do {
            try await CloudRuleSync.synchronize(store: store, containerID: id)
            personalCount = try store.read().filter { !$0.deleted }.count
            syncStatus = "iCloud sync completed at \(Date().formatted(date: .omitted, time: .shortened))."
        } catch { syncStatus = "iCloud sync failed: \(error.localizedDescription)" }
    }

    @MainActor
    private func openSettings() async {
        #if os(macOS)
        do { try await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) }
        catch { status = "Could not open Safari settings: \(error.localizedDescription)" }
        #else
        status = "Enable ADV in Settings → Apps → Safari → Extensions, then allow your chosen sites."
        #endif
    }

}

private enum Bauhaus {
    static let paper = Color(red: 0.965, green: 0.949, blue: 0.914)
    static let ink = Color(red: 0.09, green: 0.09, blue: 0.08)
    static let secondary = Color(red: 0.33, green: 0.32, blue: 0.29)
    static let red = Color(red: 0.80, green: 0.15, blue: 0.10)
    static let blue = Color(red: 0.12, green: 0.25, blue: 0.66)
    static let yellow = Color(red: 0.97, green: 0.76, blue: 0.16)
}

private struct BauhausMark: View {
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(Bauhaus.red)
                Rectangle().fill(Bauhaus.blue)
            }
            Path { path in
                path.move(to: CGPoint(x: 56, y: 0))
                path.addLine(to: CGPoint(x: 112, y: 80))
                path.addLine(to: CGPoint(x: 0, y: 80))
                path.closeSubpath()
            }
            .fill(Bauhaus.yellow)
            .frame(height: 80)
        }
    }
}

private struct BauhausButtonStyle: ButtonStyle {
    var fill: Color = Bauhaus.paper
    var foreground: Color = Bauhaus.ink
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .foregroundStyle(isEnabled ? foreground : Bauhaus.secondary)
            .background(isEnabled ? fill : Bauhaus.paper)
            .overlay(Rectangle().strokeBorder(isEnabled ? Bauhaus.ink : Bauhaus.secondary.opacity(0.4), lineWidth: 2))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
