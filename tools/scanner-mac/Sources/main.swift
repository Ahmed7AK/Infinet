// Infinet Scanner (Security spec §6): listens to the Wi-Fi around this Mac and feeds it to the booth simulation.
//
// What it does
//  • Serves the built simulation (dist/) on 127.0.0.1 at a random port, and opens it in the browser.
//  • Every few seconds runs the same Wi-Fi scan macOS runs for its own Wi-Fi menu, and pushes what it heard to the
//    page over a WebSocket (/scan), at most twice a second, at most 256 networks. One way: anything the page sends
//    is discarded. The Mac never joins, probes or attacks any network.
//
// Privacy
//  • Only networks whose name starts with "Infinet-Demo-" keep their name and BSSID. Every other network becomes an
//    anonymous dot: its name is dropped and its BSSID replaced by a salted HMAC (salt made fresh at each launch, kept
//    in memory only), before anything leaves this process. Nothing is written to disk; nothing goes off the laptop.
//  • macOS only shows Wi-Fi names to apps with Location permission, so the app asks for it once.
//
// Safety of the local server
//  • Bound to the loopback interface only. Every request must carry Host 127.0.0.1:<port> (stops DNS rebinding).
//  • The WebSocket needs the launch token (random, constant-time compare) and the page's own Origin.
//  • Static files only from the site folder: no "..", symlinks resolved and checked, GET/HEAD only.
//
// Options: --site <dir> (default: the app's Resources/site) · --port <n> · --no-open · --print-url ·
//          --dev-origin <origin> (also accept the Vite dev page, e.g. http://localhost:5173) ·
//          --fake (synthetic networks, no Wi-Fi or Location needed: for testing the pipeline) ·
//          --fake-copy-at <s> (when the fake hotspot's open copy appears; default 15 s)

import AppKit
import CoreLocation
import CoreWLAN
import CryptoKit
import Foundation
import Network
import Security

// MARK: - options and secrets

struct Options {
  var fake = false, noOpen = false, printURL = false
  var fakeCopyAt: Double = 15
  var port: UInt16 = 0
  var site: URL?
  var devOrigins: [String] = []
}

func parseOptions() -> Options {
  var o = Options()
  var it = CommandLine.arguments.dropFirst().makeIterator()
  while let a = it.next() {
    switch a {
    case "--fake": o.fake = true
    case "--fake-copy-at": if let v = it.next(), let x = Double(v) { o.fakeCopyAt = x }
    case "--no-open": o.noOpen = true
    case "--print-url": o.printURL = true
    case "--port": if let v = it.next(), let p = UInt16(v) { o.port = p }
    case "--site": if let v = it.next() { o.site = URL(fileURLWithPath: v, isDirectory: true) }
    case "--dev-origin": if let v = it.next() { o.devOrigins.append(v) }
    default: if a.hasPrefix("-NS") || a.hasPrefix("-Apple") { _ = it.next() } // launch-services noise
    }
  }
  return o
}

let opts = parseOptions()

func randomHex(_ n: Int) -> String {
  var b = [UInt8](repeating: 0, count: n)
  guard SecRandomCopyBytes(kSecRandomDefault, n, &b) == errSecSuccess else { fatalError("no randomness") }
  return b.map { String(format: "%02x", $0) }.joined()
}

let TOKEN = randomHex(24)               // 48 hex characters, new at each launch, only in the URL we open
let SALT = SymmetricKey(size: .bits256) // for the anonymous IDs; never leaves memory
let DEMO_PREFIX = "Infinet-Demo-"
let MAX_ENTRIES = 256
let SEND_EVERY: TimeInterval = 1.0      // the page applies at most 2 a second; one a second is plenty
let SCAN_EVERY: TimeInterval = 4.0      // macOS throttles faster active scans anyway
let MAX_CLIENTS = 4

func log(_ s: String) { FileHandle.standardError.write(Data("Infinet Scanner: \(s)\n".utf8)) }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

func anonID(_ bssid: String) -> String {
  let mac = HMAC<SHA256>.authenticationCode(for: Data(bssid.lowercased().utf8), using: SALT)
  return "anon-" + Data(mac).prefix(6).map { String(format: "%02x", $0) }.joined()
}

// MARK: - scanning

/// CoreWLAN security → the simulation's names. Transition and mixed modes first: they also "support" the stronger one.
func securityOf(_ n: CWNetwork) -> String {
  if n.supportsSecurity(.wpa3Enterprise) { return "WPA3-ENT" }
  if n.supportsSecurity(.wpa3Transition) { return "WPA2/3" }
  if n.supportsSecurity(.wpa3Personal) { return "WPA3-SAE" }
  if n.supportsSecurity(.wpaPersonalMixed) || n.supportsSecurity(.wpaEnterpriseMixed) { return "WPA-TKIP" }
  if n.supportsSecurity(.wpa2Enterprise) || n.supportsSecurity(.enterprise) { return "WPA2-ENT" }
  if n.supportsSecurity(.wpa2Personal) || n.supportsSecurity(.personal) { return "WPA2-PSK" }
  if n.supportsSecurity(.wpaPersonal) || n.supportsSecurity(.wpaEnterprise) { return "WPA-TKIP" }
  if n.supportsSecurity(.WEP) || n.supportsSecurity(.dynamicWEP) { return "WEP" }
  if n.supportsSecurity(.OWE) || n.supportsSecurity(.oweTransition) { return "OWE" }
  return "OPEN"
}

final class Scanner {
  private let q = DispatchQueue(label: "infinet.scan")
  private let lock = NSLock()
  private var nets: [CWNetwork] = []
  private(set) var wifiOn = true
  private let started = Date()

  func start() {
    if opts.fake { return }
    q.async { self.loop() }
  }

  private func loop() {
    while true {
      let iface = CWWiFiClient.shared().interface()
      if let iface, iface.powerOn() {
        wifiOn = true
        if let found = try? iface.scanForNetworks(withSSID: nil) {
          lock.lock(); nets = Array(found); lock.unlock()
        }
      } else {
        wifiOn = false
      }
      Thread.sleep(forTimeInterval: SCAN_EVERY)
    }
  }

  /// what goes to the page, anonymised here (the page checks again)
  func entries() -> [[String: Any]] {
    if opts.fake { return fakeEntries() }
    lock.lock(); let list = nets; lock.unlock()
    var out: [[String: Any]] = []
    var seen = Set<String>()
    for n in list.sorted(by: { $0.rssiValue > $1.rssiValue }) {
      guard out.count < MAX_ENTRIES, let raw = n.bssid?.lowercased(), !seen.contains(raw) else { continue }
      seen.insert(raw)
      let ssid = n.ssidData ?? Data()
      let name = String(data: ssid, encoding: .utf8) ?? ""
      let demo = name.hasPrefix(DEMO_PREFIX) && ssid.count <= 32
      let ch = n.wlanChannel
      let band = ch?.channelBand == .band2GHz ? "2.4" : (ch?.channelBand == .band6GHz ? "6" : "5")
      out.append([
        "bssid": demo ? raw : anonID(raw),
        "ssidHex": demo ? hex(ssid) : "",
        "security": securityOf(n),
        "channel": ch?.channelNumber ?? 1,
        "band": band,
        "rssiDbm": max(-120, min(0, n.rssiValue)),
        "anon": !demo,
      ])
    }
    return out
  }

  /// --fake: a demo hotspot, its open copy after 15 s, and a few anonymous dots (no real networks involved)
  private func fakeEntries() -> [[String: Any]] {
    let cycle = max(60, opts.fakeCopyAt + 40)
    let s = Date().timeIntervalSince(started).truncatingRemainder(dividingBy: cycle)
    let channels = [1, 6, 11, 36, 44, 149]
    var out: [[String: Any]] = []
    for i in 0..<6 {
      let security: String = i % 3 == 0 ? "WPA3-SAE" : "WPA2-PSK"
      let band: String = i < 3 ? "2.4" : "5"
      let rssi: Int = -62 - i * 5
      var e: [String: Any] = [:]
      e["bssid"] = anonID(String(format: "02:00:00:00:01:%02x", i))
      e["ssidHex"] = ""
      e["security"] = security
      e["channel"] = channels[i]
      e["band"] = band
      e["rssiDbm"] = rssi
      e["anon"] = true
      out.append(e)
    }
    let name = hex(Data("\(DEMO_PREFIX)Hotspot".utf8))
    if s > 3 { out.append(["bssid": "da:7e:00:00:00:01", "ssidHex": name, "security": "WPA2/3", "channel": 6, "band": "2.4", "rssiDbm": -47, "anon": false]) }
    if s > opts.fakeCopyAt && s < opts.fakeCopyAt + 30 { out.append(["bssid": "da:7e:00:00:00:66", "ssidHex": name, "security": "OPEN", "channel": 6, "band": "2.4", "rssiDbm": -36, "anon": false]) }
    return out
  }
}

// MARK: - HTTP + WebSocket on 127.0.0.1

let MIME: [String: String] = [
  "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
  "css": "text/css; charset=utf-8", "json": "application/json", "svg": "image/svg+xml", "png": "image/png",
  "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "ktx2": "image/ktx2", "ico": "image/x-icon",
  "glb": "model/gltf-binary", "gltf": "model/gltf+json", "bin": "application/octet-stream", "hdr": "application/octet-stream",
  "exr": "application/octet-stream", "wasm": "application/wasm", "woff2": "font/woff2", "woff": "font/woff",
  "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8",
]

func wsFrame(_ payload: Data, opcode: UInt8 = 0x1) -> Data {
  var d = Data([0x80 | opcode])
  let n = payload.count
  if n < 126 { d.append(UInt8(n)) }
  else if n < 65536 { d.append(126); d.append(UInt8(n >> 8)); d.append(UInt8(n & 0xff)) }
  else { d.append(127); for i in (0..<8).reversed() { d.append(UInt8((UInt64(n) >> UInt64(i * 8)) & 0xff)) } }
  d.append(payload)
  return d
}

func constantTimeEqual(_ a: String, _ b: String) -> Bool {
  let x = Array(a.utf8), y = Array(b.utf8)
  guard x.count == y.count else { return false }
  var r: UInt8 = 0
  for i in 0..<x.count { r |= x[i] ^ y[i] }
  return r == 0
}

final class Server {
  private let listener: NWListener
  private let q = DispatchQueue(label: "infinet.server")
  private let site: URL
  private var clients: [ObjectIdentifier: NWConnection] = [:]
  private(set) var port: UInt16 = 0
  var onReady: ((UInt16) -> Void)?
  var message: () -> Data = { Data() }

  init(port: UInt16, site: URL) throws {
    let p = NWParameters.tcp
    p.requiredInterfaceType = .loopback
    p.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: port == 0 ? .any : NWEndpoint.Port(rawValue: port)!)
    listener = try NWListener(using: p)
    self.site = site.resolvingSymlinksInPath().standardizedFileURL
  }

  var clientCount: Int { q.sync { clients.count } }

  func start() {
    listener.stateUpdateHandler = { [weak self] st in
      guard let self else { return }
      switch st {
      case .ready:
        self.port = self.listener.port?.rawValue ?? 0
        DispatchQueue.main.async { self.onReady?(self.port) }
      case .failed(let e): log("listener failed: \(e)"); exit(1)
      default: break
      }
    }
    listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
    listener.start(queue: q)
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + SEND_EVERY, repeating: SEND_EVERY)
    t.setEventHandler { [weak self] in self?.broadcast() }
    t.resume()
    timer = t
  }
  private var timer: DispatchSourceTimer?

  private func accept(_ c: NWConnection) {
    c.start(queue: q)
    readRequest(c, Data())
  }

  private func drop(_ c: NWConnection) {
    clients.removeValue(forKey: ObjectIdentifier(c))
    c.cancel()
  }

  private func broadcast() {
    guard !clients.isEmpty else { return }
    let f = wsFrame(message())
    for c in clients.values { c.send(content: f, completion: .contentProcessed { _ in }) }
  }

  // ── HTTP ──
  private func readRequest(_ c: NWConnection, _ buf: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, done, err in
      guard let self else { return }
      var b = buf
      if let data { b.append(data) }
      if let r = b.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: b[b.startIndex..<r.lowerBound], as: UTF8.self)
        self.handle(c, head)
        return
      }
      if b.count > 16384 || done || err != nil { c.cancel(); return }
      self.readRequest(c, b)
    }
  }

  private func respond(_ c: NWConnection, _ code: Int, _ reason: String, close: Bool = true) {
    let body = Data("\(code) \(reason)\n".utf8)
    let h = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
    c.send(content: Data(h.utf8) + body, completion: .contentProcessed { _ in c.cancel() })
  }

  private func handle(_ c: NWConnection, _ head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = (lines.first ?? "").split(separator: " ")
    guard parts.count == 3 else { return respond(c, 400, "Bad Request") }
    var headers: [String: String] = [:]
    for l in lines.dropFirst() {
      guard let i = l.firstIndex(of: ":") else { continue }
      headers[l[..<i].trimmingCharacters(in: .whitespaces).lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
    }
    let method = String(parts[0]), target = String(parts[1])
    // DNS rebinding: a web page that points its own name at 127.0.0.1 still sends its own Host
    let host = headers["host"] ?? ""
    guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else { return respond(c, 421, "Misdirected Request") }
    guard method == "GET" || method == "HEAD" else { return respond(c, 405, "Method Not Allowed") }
    let comps = URLComponents(string: "http://h\(target)")
    let path = comps?.percentEncodedPath.removingPercentEncoding ?? "/"
    if path == "/scan" { return upgrade(c, headers, comps?.queryItems ?? []) }
    serve(c, path, head: method == "HEAD")
  }

  private func serve(_ c: NWConnection, _ rawPath: String, head: Bool) {
    var p = rawPath
    if p.hasSuffix("/") { p += "index.html" }
    guard p.hasPrefix("/"), !p.contains(".."), !p.contains("\0") else { return respond(c, 400, "Bad Request") }
    let url = site.appendingPathComponent(String(p.dropFirst())).resolvingSymlinksInPath().standardizedFileURL
    guard url.path.hasPrefix(site.path + "/") else { return respond(c, 404, "Not Found") }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue,
          let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return respond(c, 404, "Not Found") }
    let ext = url.pathExtension.lowercased()
    let type = MIME[ext] ?? "application/octet-stream"
    let cache = ext == "html" ? "no-store" : "max-age=3600"
    let h = "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nCache-Control: \(cache)\r\n" +
      "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: keep-alive\r\n\r\n"
    c.send(content: Data(h.utf8), completion: .contentProcessed { _ in })
    c.send(content: head ? Data() : data, completion: .contentProcessed { [weak self] e in
      if e != nil { c.cancel() } else { self?.readRequest(c, Data()) }
    })
  }

  // ── WebSocket (RFC 6455), server → page only ──
  private func upgrade(_ c: NWConnection, _ headers: [String: String], _ query: [URLQueryItem]) {
    let token = query.first(where: { $0.name == "token" })?.value ?? ""
    let origin = headers["origin"] ?? ""
    let okOrigin = origin == "http://127.0.0.1:\(port)" || opts.devOrigins.contains(origin)
    guard constantTimeEqual(token, TOKEN), okOrigin else { return respond(c, 403, "Forbidden") }
    guard (headers["upgrade"] ?? "").lowercased() == "websocket", headers["sec-websocket-version"] == "13",
          let key = headers["sec-websocket-key"], !key.isEmpty else { return respond(c, 400, "Bad Request") }
    guard clients.count < MAX_CLIENTS else { return respond(c, 503, "Too Many Viewers") }
    let accept = Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
    let h = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
    c.send(content: Data(h.utf8), completion: .contentProcessed { [weak self] e in
      guard let self, e == nil else { c.cancel(); return }
      self.clients[ObjectIdentifier(c)] = c
      c.send(content: wsFrame(self.message()), completion: .contentProcessed { _ in })
      self.readFrames(c, Data())
    })
  }

  /// the page may only close or ping; anything else it sends is read and thrown away (this channel is one way)
  private func readFrames(_ c: NWConnection, _ buf: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, done, err in
      guard let self else { return }
      var b = buf
      if let data { b.append(data) }
      if b.count > 65536 { return self.drop(c) }
      while b.count >= 2 {
        let s = b.startIndex
        let op = b[s] & 0x0f, masked = b[s + 1] & 0x80 != 0
        var len = Int(b[s + 1] & 0x7f), at = 2
        if len == 126 { guard b.count >= 4 else { break }; len = Int(b[s + 2]) << 8 | Int(b[s + 3]); at = 4 }
        else if len == 127 { return self.drop(c) }
        let need = at + (masked ? 4 : 0) + len
        guard b.count >= need else { break }
        if op == 0x8 { c.send(content: wsFrame(Data(), opcode: 0x8), completion: .contentProcessed { _ in self.drop(c) }); return }
        if op == 0x9 { c.send(content: wsFrame(Data(), opcode: 0xA), completion: .contentProcessed { _ in }) }
        b = Data(b[(s + need)...])
      }
      if done || err != nil { return self.drop(c) }
      self.readFrames(c, b)
    }
  }
}

// MARK: - app

final class AppDelegate: NSObject, NSApplicationDelegate, CLLocationManagerDelegate {
  private let location = CLLocationManager()
  private let scanner = Scanner()
  private var server: Server?
  private var item: NSStatusItem?
  private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
  private var pageURL: URL?
  private var lastCount = 0, lastNamed = 0

  private var locationOK: Bool {
    // authorizedAlways (3) or authorizedWhenInUse (4); macOS reports either once the user allows it
    opts.fake || location.authorizationStatus.rawValue >= 3
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    let site = opts.site ?? Bundle.main.resourceURL?.appendingPathComponent("site", isDirectory: true)
    guard let site, FileManager.default.fileExists(atPath: site.appendingPathComponent("index.html").path) else {
      log("no built simulation found; build it first (tools/scanner-mac/build.sh), or pass --site <dist folder>")
      exit(2)
    }
    if !opts.fake { location.delegate = self; location.requestWhenInUseAuthorization() }
    do { server = try Server(port: opts.port, site: site) } catch { log("cannot listen: \(error)"); exit(1) }
    server?.message = { [weak self] in self?.message() ?? Data() }
    server?.onReady = { [weak self] port in self?.ready(port) }
    server?.start()
    scanner.start()
    if !(opts.fake && opts.noOpen) { makeMenu() }
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refreshMenu() }
  }

  private func ready(_ port: UInt16) {
    let url = URL(string: "http://127.0.0.1:\(port)/?live=1&token=\(TOKEN)")!
    pageURL = url
    log("serving the simulation on http://127.0.0.1:\(port) (loopback only)")
    if opts.printURL { print(url.absoluteString); fflush(stdout) }
    if !opts.noOpen { NSWorkspace.shared.open(url) }
  }

  private func message() -> Data {
    var obj: [String: Any]
    if !locationOK { obj = ["v": 1, "type": "status", "state": "no-location"] }
    else if !opts.fake && !scanner.wifiOn { obj = ["v": 1, "type": "status", "state": "no-wifi"] }
    else {
      let e = scanner.entries()
      lastCount = e.count
      lastNamed = e.filter { ($0["anon"] as? Bool) == false }.count
      obj = ["v": 1, "type": "scan", "entries": e]
    }
    return (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
  }

  private func makeMenu() {
    let it = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    it.button?.title = "Infinet ◦"
    let m = NSMenu()
    statusLine.isEnabled = false
    m.addItem(statusLine)
    m.addItem(.separator())
    m.addItem(NSMenuItem(title: "Open the simulation", action: #selector(openPage), keyEquivalent: "o"))
    m.addItem(NSMenuItem(title: "Location settings…", action: #selector(openLocationSettings), keyEquivalent: ""))
    m.addItem(.separator())
    m.addItem(NSMenuItem(title: "Quit Infinet Scanner", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    for i in m.items { i.target = i.action == #selector(NSApplication.terminate(_:)) ? nil : self }
    it.menu = m
    item = it
  }

  private func refreshMenu() {
    let viewers = server?.clientCount ?? 0
    let text: String
    if !locationOK { text = "Needs Location permission to read network names" }
    else if !opts.fake && !scanner.wifiOn { text = "Wi-Fi is off" }
    else { text = "\(lastCount) networks nearby · \(lastNamed) Infinet-Demo · \(viewers) viewer\(viewers == 1 ? "" : "s")" }
    statusLine.title = text
    item?.button?.title = viewers > 0 ? "Infinet ●" : "Infinet ◦"
  }

  @objc private func openPage() { if let u = pageURL { NSWorkspace.shared.open(u) } }
  @objc private func openLocationSettings() {
    if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") { NSWorkspace.shared.open(u) }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { refreshMenu() }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
