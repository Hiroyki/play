// Menggambar ikon launcher Android dari public/icon.svg sebagai PNG biasa.
//   swift android/icon.swift public/icon.svg android/res
// Sengaja bukan adaptive icon: launcher bawaan banyak head unit tidak bisa menggambarnya.
// Bentuknya lingkaran penuh, jadi launcher HP yang membungkus ikon lama tidak menambah latar putih.
import AppKit

let svg = NSImage(contentsOfFile: CommandLine.arguments[1])!
let res = URL(fileURLWithPath: CommandLine.arguments[2])
for (name, px) in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)] {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current!.imageInterpolation = .high
    let s = CGFloat(px)
    let full = NSRect(x: 0, y: 0, width: s, height: s)
    NSColor.black.setFill()
    NSBezierPath(ovalIn: full).fill()
    // Sama dengan ikon adaptif sebelumnya: logo sekitar dua pertiga lebar yang terlihat.
    svg.draw(in: full.insetBy(dx: s * 0.17, dy: s * 0.17))
    NSGraphicsContext.current = nil
    let dir = res.appendingPathComponent("mipmap-" + name)
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try! rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent("ic_launcher.png"))
}
