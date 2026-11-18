// targets/widget/widgets.swift  —  NEW FILE
//
// 🍎 PlayOn Slots — iPhone widget for turf owners (same design as Android)
// ─────────────────────────────────────────────────────────────────────────────
//   Small   → today's totals: "9 free · 0 booked · 1 blocked" (all turfs)
//   Medium  → one turf: name + counts, turf buttons (tap to switch, iOS 17),
//             remaining slots as coloured chips, legend + "Next free"
//   Large   → all turfs together (up to 3), remaining slots, legend
//   Lock    → circular "9 free" · rectangular one line per turf
//
// DATA: the app (utils/ownerQuickView.tsx) saves today's slots into the App
// Group "group.com.playonnew.app" under "qv_data" every time owner home loads.
// The widget never talks to Firestore.
// Finished slots drop off by themselves: the timeline has an entry at every
// slot end, so no app open is needed for that.
// Colours: Free light green · Booked blue · Blocked orange · black border = now
// ─────────────────────────────────────────────────────────────────────────────

import WidgetKit
import SwiftUI
import AppIntents

private let appGroup = "group.com.playonnew.app"
private let dataKey  = "qv_data"
private let selKey   = "qv_sel"

// ── Data (same shape the app saves) ──────────────────────────────────────────
struct QSlot: Codable { let s: Double; let e: Double; let st: String }   // st: "f" free · "b" booked · "x" blocked
struct QTurf: Codable { let id: String; let name: String; let sport: String?; let slots: [QSlot] }
struct QData: Codable { let dateKey: String; let updatedAt: Double; let turfs: [QTurf] }

enum Store {
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  static func load() -> QData? {
    guard let raw = defaults?.string(forKey: dataKey), !raw.isEmpty,
          let d = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(QData.self, from: d)
  }

  static var selected: Int { defaults?.integer(forKey: selKey) ?? 0 }
}

// ── Turf buttons (iOS 17 interactive widget) ─────────────────────────────────
struct SelectTurfIntent: AppIntent {
  static let title: LocalizedStringResource = "Show turf"
  static let isDiscoverable: Bool = false

  @Parameter(title: "Turf") var index: Int

  init() {}
  init(index: Int) { self.index = index }

  func perform() async throws -> some IntentResult {
    UserDefaults(suiteName: appGroup)?.set(index, forKey: selKey)
    return .result()   // WidgetKit redraws the widget right after this
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
private func localDateKey(_ date: Date) -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}

private func hourOf(_ date: Date) -> Double {
  let c = Calendar.current.dateComponents([.hour, .minute], from: date)
  return Double(c.hour ?? 0) + Double(c.minute ?? 0) / 60.0
}

/// "7p", "12a", "6:30p"
private func chipLabel(_ h: Double) -> String {
  let hh = (h.truncatingRemainder(dividingBy: 24) + 24).truncatingRemainder(dividingBy: 24)
  let hour = Int(hh)
  let min = Int(((hh - Double(hour)) * 60).rounded())
  let suf = hour >= 12 ? "p" : "a"
  let hr = hour % 12 == 0 ? 12 : hour % 12
  return min > 0 ? "\(hr):\(String(format: "%02d", min))\(suf)" : "\(hr)\(suf)"
}

/// "7 PM", "6:30 AM"
private func timeLabel(_ h: Double) -> String {
  let hh = (h.truncatingRemainder(dividingBy: 24) + 24).truncatingRemainder(dividingBy: 24)
  let hour = Int(hh)
  let min = Int(((hh - Double(hour)) * 60).rounded())
  let suf = hour >= 12 ? "PM" : "AM"
  let hr = hour % 12 == 0 ? 12 : hour % 12
  return min > 0 ? "\(hr):\(String(format: "%02d", min)) \(suf)" : "\(hr) \(suf)"
}

extension Color {
  init(hex: UInt) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255)
  }
}

private enum Pal {
  static let freeBg    = Color(hex: 0xBBF7D0)
  static let freeTx    = Color(hex: 0x14532D)
  static let booked    = Color(hex: 0x2563EB)
  static let blocked   = Color(hex: 0xF97316)
  static let green     = Color(hex: 0x15803D)
  static let ink       = Color(hex: 0x111827)
  static let sub       = Color(hex: 0x374151)
  static let line      = Color(hex: 0xE5E7EB)
  static let pillLine  = Color(hex: 0xD1D5DB)
}

private struct TurfStats {
  let left: [QSlot]
  let free: Int, booked: Int, blocked: Int
  let nextFree: QSlot?

  init(_ turf: QTurf, _ nowH: Double) {
    left = turf.slots.filter { $0.e > nowH }               // finished slots hidden
    free = left.filter { $0.st == "f" }.count
    booked = left.filter { $0.st == "b" }.count
    blocked = left.filter { $0.st == "x" }.count
    nextFree = left.first { $0.st == "f" }
  }

  var counts: String {
    var p = ["\(free) free"]
    if booked > 0 { p.append("\(booked) booked") }
    if blocked > 0 { p.append("\(blocked) blocked") }
    return p.joined(separator: " · ")
  }

  var nextText: String { nextFree.map { "Next free: \(timeLabel($0.s))" } ?? "No free slot left" }
}

private func totals(_ data: QData, _ nowH: Double) -> (free: Int, booked: Int, blocked: Int) {
  var f = 0, b = 0, x = 0
  for t in data.turfs { let s = TurfStats(t, nowH); f += s.free; b += s.booked; x += s.blocked }
  return (f, b, x)
}

// ── Timeline ─────────────────────────────────────────────────────────────────
struct Entry: TimelineEntry {
  let date: Date
  let data: QData?
  let sel: Int
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: Date(), data: sampleData, sel: 0) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), data: Store.load() ?? sampleData, sel: Store.selected))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    let data = Store.load()
    let sel = Store.selected
    var entries = [Entry(date: now, data: data, sel: sel)]
    let startOfDay = Calendar.current.startOfDay(for: now)

    // One entry at every slot end today → finished slots drop off by themselves
    if let d = data, d.dateKey == localDateKey(now) {
      let ends = Set(d.turfs.flatMap { $0.slots.map { $0.e } }).sorted()
      for e in ends {
        let t = startOfDay.addingTimeInterval(e * 3600)
        if t > now { entries.append(Entry(date: t, data: d, sel: sel)) }
      }
    }
    // Just after midnight → "Open PlayOn to load today's slots"
    entries.append(Entry(date: startOfDay.addingTimeInterval(86_400 + 60), data: data, sel: sel))

    entries.sort { $0.date < $1.date }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// ── Small pieces ─────────────────────────────────────────────────────────────
private struct Chip: View {
  let slot: QSlot
  let isNow: Bool
  let height: CGFloat

  var body: some View {
    let bg: Color = slot.st == "f" ? Pal.freeBg : (slot.st == "b" ? Pal.booked : Pal.blocked)
    let fg: Color = slot.st == "f" ? Pal.freeTx : .white
    Text(chipLabel(slot.s))
      .font(.system(size: 11, weight: .heavy))
      .foregroundColor(fg)
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .frame(maxWidth: .infinity)
      .frame(height: height)
      .background(RoundedRectangle(cornerRadius: 7).fill(bg))
      .overlay(RoundedRectangle(cornerRadius: 7).stroke(isNow ? Pal.ink : Color.clear, lineWidth: 2))
  }
}

private struct ChipGrid: View {
  let slots: [QSlot]
  let nowH: Double
  let maxCount: Int
  let height: CGFloat

  var body: some View {
    let shown = Array(slots.prefix(maxCount))
    let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 8)
    LazyVGrid(columns: cols, spacing: 4) {
      ForEach(Array(shown.enumerated()), id: \.offset) { _, s in
        Chip(slot: s, isNow: s.s <= nowH && nowH < s.e, height: height)
      }
    }
  }
}

private struct Legend: View {
  let right: String
  var body: some View {
    HStack(spacing: 8) {
      dot(Pal.freeBg, "Free")
      dot(Pal.booked, "Booked")
      dot(Pal.blocked, "Blocked")
      Spacer(minLength: 4)
      Text(right).font(.system(size: 11, weight: .heavy)).foregroundColor(Pal.ink).lineLimit(1)
    }
  }
  private func dot(_ c: Color, _ t: String) -> some View {
    HStack(spacing: 3) {
      RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9)
      Text(t).font(.system(size: 10)).foregroundColor(Pal.sub)
    }
  }
}

private struct TurfButton: View {
  let title: String
  let index: Int
  let on: Bool
  var body: some View {
    Button(intent: SelectTurfIntent(index: index)) {
      Text(title)
        .font(.system(size: 11, weight: .bold))
        .lineLimit(1)
        .frame(maxWidth: 72)
        .padding(.horizontal, 9)
        .frame(height: 24)
        .foregroundColor(on ? .white : Pal.ink)
        .background(Capsule().fill(on ? Pal.green : Color.white))
        .overlay(Capsule().stroke(on ? Color.clear : Pal.pillLine, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }
}

private struct OpenAppMessage: View {
  var body: some View {
    VStack(spacing: 6) {
      Text("PlayOn").font(.system(size: 14, weight: .heavy)).foregroundColor(Pal.ink)
      Text("Open PlayOn to load today's slots")
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(Pal.sub)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

// ── Sizes ────────────────────────────────────────────────────────────────────
private struct SmallView: View {
  let data: QData
  let nowH: Double
  var body: some View {
    let t = totals(data, nowH)
    VStack(alignment: .leading, spacing: 0) {
      Text("Today").font(.system(size: 13, weight: .bold)).foregroundColor(Pal.ink)
      Spacer(minLength: 4)
      HStack(alignment: .firstTextBaseline, spacing: 5) {
        Text("\(t.free)").font(.system(size: 30, weight: .heavy)).foregroundColor(Pal.green)
        Text("free").font(.system(size: 14, weight: .semibold)).foregroundColor(Pal.ink)
      }
      HStack(spacing: 10) {
        Text("\(t.booked) booked").foregroundColor(Pal.booked)
        Text("\(t.blocked) blocked").foregroundColor(Pal.blocked)
      }
      .font(.system(size: 12, weight: .semibold))
      Spacer(minLength: 4)
      Text("all turfs").font(.system(size: 11)).foregroundColor(Pal.sub)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

private struct MediumView: View {
  let data: QData
  let sel: Int
  let nowH: Double
  var body: some View {
    let i = (sel >= 0 && sel < data.turfs.count) ? sel : 0
    let turf = data.turfs[i]
    let st = TurfStats(turf, nowH)
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .center, spacing: 6) {
        VStack(alignment: .leading, spacing: 1) {
          Text(turf.name + ((turf.sport ?? "").isEmpty ? "" : " · \(turf.sport!)"))
            .font(.system(size: 15, weight: .heavy)).foregroundColor(Pal.ink).lineLimit(1)
          Text(st.counts).font(.system(size: 12, weight: .semibold)).foregroundColor(Pal.sub).lineLimit(1)
        }
        Spacer(minLength: 4)
        turfButtons(i)
      }
      if st.left.isEmpty {
        Text("No slots left today").font(.system(size: 12, weight: .semibold)).foregroundColor(Pal.sub)
        Spacer(minLength: 0)
      } else {
        ChipGrid(slots: st.left, nowH: nowH, maxCount: 16, height: 26)
        Spacer(minLength: 0)
      }
      Legend(right: st.nextText)
    }
  }

  @ViewBuilder
  private func turfButtons(_ i: Int) -> some View {
    let n = data.turfs.count
    if n >= 2 && n <= 3 {
      HStack(spacing: 4) {
        ForEach(0..<n, id: \.self) { k in
          TurfButton(title: data.turfs[k].name, index: k, on: k == i)
        }
      }
    } else if n > 3 {
      HStack(spacing: 4) {
        TurfButton(title: "◀", index: (i - 1 + n) % n, on: false)
        Text("\(i + 1)/\(n)").font(.system(size: 11, weight: .bold)).foregroundColor(Pal.sub)
        TurfButton(title: "▶", index: (i + 1) % n, on: false)
      }
    }
  }
}

private struct LargeView: View {
  let data: QData
  let nowH: Double
  var body: some View {
    let t = totals(data, nowH)
    let shown = Array(data.turfs.prefix(3))
    let updated = Date(timeIntervalSince1970: data.updatedAt / 1000)
    VStack(alignment: .leading, spacing: 9) {
      Text("Today · \(t.free) free · \(t.booked) booked · \(t.blocked) blocked")
        .font(.system(size: 14, weight: .heavy)).foregroundColor(Pal.ink).lineLimit(1)
        .minimumScaleFactor(0.8)
      ForEach(Array(shown.enumerated()), id: \.offset) { idx, turf in
        let st = TurfStats(turf, nowH)
        if idx > 0 { Rectangle().fill(Pal.line).frame(height: 1) }
        VStack(alignment: .leading, spacing: 5) {
          HStack {
            Text(turf.name + ((turf.sport ?? "").isEmpty ? "" : " · \(turf.sport!)"))
              .font(.system(size: 14, weight: .heavy)).foregroundColor(Pal.ink).lineLimit(1)
            Spacer(minLength: 4)
            Text(st.counts).font(.system(size: 12, weight: .semibold)).foregroundColor(Pal.sub).lineLimit(1)
          }
          if st.left.isEmpty {
            Text("No slots left today").font(.system(size: 12, weight: .semibold)).foregroundColor(Pal.sub)
          } else {
            ChipGrid(slots: st.left, nowH: nowH, maxCount: 16, height: 24)
            Text(st.nextText).font(.system(size: 11, weight: .heavy)).foregroundColor(Pal.ink)
          }
        }
      }
      if data.turfs.count > 3 {
        Text("+\(data.turfs.count - 3) more turfs — open PlayOn")
          .font(.system(size: 11, weight: .semibold)).foregroundColor(Pal.sub)
      }
      Spacer(minLength: 0)
      Legend(right: "updated \(updated.formatted(date: .omitted, time: .shortened))")
    }
  }
}

private struct CircularView: View {
  let data: QData
  let nowH: Double
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Text("\(totals(data, nowH).free)").font(.system(size: 22, weight: .heavy))
        Text("free").font(.system(size: 10, weight: .semibold))
      }
    }
  }
}

private struct RectangularView: View {
  let data: QData
  let nowH: Double
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(Array(data.turfs.prefix(3).enumerated()), id: \.offset) { idx, turf in
        let st = TurfStats(turf, nowH)
        let next = st.nextFree.map { " · next \(timeLabel($0.s))" } ?? ""
        Text("\(turf.name) · \(st.free) free\(next)")
          .font(.system(size: 13, weight: idx == 0 ? .bold : .semibold))
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// ── Widget ───────────────────────────────────────────────────────────────────
struct WidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry

  var body: some View {
    let nowH = hourOf(entry.date)
    let fresh = entry.data.flatMap { $0.dateKey == localDateKey(entry.date) && !$0.turfs.isEmpty ? $0 : nil }
    let isAccessory = family == .accessoryCircular || family == .accessoryRectangular

    Group {
      if let d = fresh {
        switch family {
        case .systemSmall:           SmallView(data: d, nowH: nowH)
        case .systemMedium:          MediumView(data: d, sel: entry.sel, nowH: nowH)
        case .systemLarge:           LargeView(data: d, nowH: nowH)
        case .accessoryCircular:     CircularView(data: d, nowH: nowH)
        case .accessoryRectangular:  RectangularView(data: d, nowH: nowH)
        default:                     SmallView(data: d, nowH: nowH)
        }
      } else if isAccessory {
        Text("Open PlayOn").font(.system(size: 12, weight: .semibold))
      } else {
        OpenAppMessage()
      }
    }
    .containerBackground(for: .widget) { isAccessory ? Color.clear : Color.white }
    .widgetURL(URL(string: "playon://"))
  }
}

struct PlayOnSlotsWidget: Widget {
  let kind = "PlayOnSlots"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      WidgetView(entry: entry)
    }
    .configurationDisplayName("PlayOn Slots")
    .description("Today's free, booked and blocked slots of your turfs.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular])
  }
}

// ── Sample (widget gallery preview only) ─────────────────────────────────────
private let sampleData = QData(
  dateKey: localDateKey(Date()),
  updatedAt: Date().timeIntervalSince1970 * 1000,
  turfs: [
    QTurf(id: "a", name: "Titan", sport: "Cricket", slots: [
      QSlot(s: 19, e: 20, st: "f"), QSlot(s: 20, e: 21, st: "f"), QSlot(s: 21, e: 22, st: "f"),
      QSlot(s: 22, e: 23, st: "x"), QSlot(s: 23, e: 24, st: "f"),
    ]),
    QTurf(id: "b", name: "Big hiters", sport: "Football", slots: [
      QSlot(s: 19, e: 20, st: "f"), QSlot(s: 20, e: 21, st: "b"), QSlot(s: 21, e: 22, st: "f"),
      QSlot(s: 22, e: 23, st: "f"), QSlot(s: 23, e: 24, st: "f"),
    ]),
  ]
)
