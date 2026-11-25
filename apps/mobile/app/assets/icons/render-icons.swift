// Usage: swift render-icons.swift in.svg out.png 72
// shortcut: macOS-only dev script, port when someone builds icons off macOS
import AppKit

let arguments = CommandLine.arguments
guard arguments.count == 4, let size = Int(arguments[3]), size > 0 else {
    fatalError("Usage: swift render-icons.swift in.svg out.png size")
}

guard let image = NSImage(contentsOfFile: arguments[1]) else {
    fatalError("Could not read \(arguments[1])")
}
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Could not create a \(size) px bitmap")
}

let bounds = CGRect(x: 0, y: 0, width: size, height: size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(bounds)
image.draw(in: bounds)
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Could not encode PNG")
}
try png.write(to: URL(fileURLWithPath: arguments[2]))
