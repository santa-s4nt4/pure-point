import AppKit

// Make a full-size raster from the supplied artwork for Tauri's icon bundler.
let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let artwork = project.appendingPathComponent("public/floating-P.png")
guard CommandLine.arguments.count == 2, let image = NSImage(contentsOf: artwork) else { exit(1) }
let output = NSImage(size: NSSize(width: 1024, height: 1024))
output.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(origin: .zero, size: output.size))
output.unlockFocus()
guard let tiff = output.tiffRepresentation,
      let data = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
