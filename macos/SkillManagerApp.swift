import AppKit
import WebKit
import Darwin

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var startupTimer: Timer?
    private var port: UInt16 = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        configureMenu()
        createWindow()
        do {
            try startServer()
            waitForServer()
        } catch {
            showError("Skill 管理器启动失败", detail: error.localizedDescription)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        startupTimer?.invalidate()
        if let server, server.isRunning { server.terminate() }
    }

    func windowWillClose(_ notification: Notification) {
        if let server, server.isRunning { server.terminate() }
    }

    private func configureMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: "Skill Manager")
        appMenu.addItem(withTitle: "关于 Skill Manager", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Skill Manager", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Skill Manager", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Skill Manager"
        window.minSize = NSSize(width: 820, height: 600)
        window.center()
        window.contentView = content
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    private func startServer() throws {
        let resources = Bundle.main.resourceURL!
        let appRoot = resources.appendingPathComponent("app", isDirectory: true)
        let node = resources.appendingPathComponent("app/runtime/node")
        let entry = appRoot.appendingPathComponent("build/server/index.js")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: entry.path) else {
            throw NSError(domain: "SkillManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "安装包缺少运行文件，请重新下载并安装。"])
        }

        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Skill Manager", isDirectory: true)
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        let configuredDataDirectory = ProcessInfo.processInfo.environment["SKILL_MANAGER_DATA_DIR"]
        let requestedDataDirectory = configuredDataDirectory.map {
            URL(fileURLWithPath: $0, isDirectory: true).standardizedFileURL
        } ?? support.appendingPathComponent(".skill-manager", isDirectory: true)
        let legacyData = appRoot.appendingPathComponent(".skill-manager", isDirectory: true)
        if !FileManager.default.fileExists(atPath: requestedDataDirectory.path),
           FileManager.default.fileExists(atPath: legacyData.path) {
            try FileManager.default.createDirectory(
                at: requestedDataDirectory.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try FileManager.default.copyItem(at: legacyData, to: requestedDataDirectory)
        } else {
            try FileManager.default.createDirectory(at: requestedDataDirectory, withIntermediateDirectories: true)
        }
        guard let resolvedDataPath = requestedDataDirectory.path.withCString({ realpath($0, nil) }) else {
            throw posixError("无法解析状态目录")
        }
        defer { Darwin.free(resolvedDataPath) }
        let dataDirectory = URL(
            fileURLWithPath: String(cString: resolvedDataPath),
            isDirectory: true
        )
        port = try findAvailablePort()
        let process = Process()
        process.executableURL = node
        process.arguments = [entry.path]
        process.currentDirectoryURL = appRoot
        var environment = ProcessInfo.processInfo.environment
        environment["NODE_ENV"] = "production"
        environment["SKILL_MANAGER_ROOT"] = appRoot.path
        environment["SKILL_MANAGER_DATA_DIR"] = dataDirectory.path
        environment["PORT"] = String(port)
        process.environment = environment
        try process.run()
        server = process
    }

    private func findAvailablePort() throws -> UInt16 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posixError("无法分配本地端口") }
        defer { Darwin.close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        let converted = "127.0.0.1".withCString {
            inet_pton(AF_INET, $0, &address.sin_addr)
        }
        guard converted == 1 else { throw posixError("无法解析本地地址") }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { throw posixError("无法分配本地端口") }
        var result = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &result) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &length)
            }
        }
        guard named == 0 else { throw posixError("无法读取本地端口") }
        return UInt16(bigEndian: result.sin_port)
    }

    private func waitForServer() {
        let url = URL(string: "http://127.0.0.1:\(port)/")!
        var attempts = 0
        startupTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            attempts += 1
            if let server = self.server, !server.isRunning {
                timer.invalidate()
                self.showError("Skill 管理器启动失败", detail: "本地服务意外退出。请重新安装应用后再试。")
                return
            }
            if attempts > 80 {
                timer.invalidate()
                self.showError("Skill 管理器启动超时", detail: "本地服务没有在预期时间内就绪。请退出应用后重试。")
                return
            }
            URLSession.shared.dataTask(with: url) { _, response, _ in
                guard let response = response as? HTTPURLResponse, (200..<400).contains(response.statusCode) else { return }
                DispatchQueue.main.async {
                    timer.invalidate()
                    self.webView.load(URLRequest(url: url))
                }
            }.resume()
        }
    }

    private func showError(_ title: String, detail: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.alertStyle = .critical
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func posixError(_ message: String) -> NSError {
        NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [NSLocalizedDescriptionKey: message])
    }
}

@main
enum SkillManagerMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}
