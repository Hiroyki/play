// Menggambar ikon aplikasi dari public/icon.svg ke bentuk ikon macOS.
//   swift mac/icon.swift public/icon.svg <folder .iconset>
import AppKit

let svg = NSImage(contentsOfFile: CommandLine.arguments[1])!
let out = CommandLine.arguments[2]
for pt in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let px = pt * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current!.imageInterpolation = .high
        // Kisi ikon macOS: bidang 824 dari 1024, sudut 185.
        let s = CGFloat(px)
        let box = NSRect(x: s * 100 / 1024, y: s * 100 / 1024, width: s * 824 / 1024, height: s * 824 / 1024)
        NSBezierPath(roundedRect: box, xRadius: s * 185 / 1024, yRadius: s * 185 / 1024).addClip()
        NSColor.black.setFill()
        box.fill()
        svg.draw(in: box.insetBy(dx: box.width * 0.08, dy: box.height * 0.08))
        let name = "icon_\(pt)x\(pt)\(scale == 2 ? "@2x" : "").png"
        try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out).appendingPathComponent(name))
    }
}
