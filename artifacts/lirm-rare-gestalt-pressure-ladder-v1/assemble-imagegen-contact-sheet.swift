import AppKit
import Foundation

struct Cell: Decodable {
    let sourcePath: String
    let title: String
    let viewLabel: String
}

struct Sheet: Decodable {
    let columns: Int
    let rows: Int
    let width: Int
    let cellWidth: Int
    let cellHeight: Int
    let imageHeight: Int
    let imageOffsetY: Int
    let cells: [Cell]
}

guard CommandLine.arguments.count == 3 else {
    fputs("usage: assemble-imagegen-contact-sheet.swift manifest.json output.png\n", stderr)
    exit(2)
}

let manifestURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let sheet = try JSONDecoder().decode(Sheet.self, from: Data(contentsOf: manifestURL))
guard sheet.cells.count == sheet.columns * sheet.rows else {
    fputs("contact sheet cell count does not match rows and columns\n", stderr)
    exit(2)
}
guard sheet.width == sheet.cellWidth * sheet.columns else {
    fputs("contact sheet width does not match columns\n", stderr)
    exit(2)
}

let height = sheet.rows * sheet.cellHeight
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: sheet.width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!
bitmap.size = NSSize(width: sheet.width, height: height)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: sheet.width, height: height).fill()

let titleStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium),
    .foregroundColor: NSColor(calibratedRed: 0.95, green: 0.78, blue: 0.28, alpha: 1),
]
let viewStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
    .foregroundColor: NSColor(calibratedWhite: 0.82, alpha: 1),
]

for (index, cell) in sheet.cells.enumerated() {
    guard let source = NSImage(contentsOfFile: cell.sourcePath) else {
        fputs("could not load image: \(cell.sourcePath)\n", stderr)
        exit(1)
    }
    let column = index % sheet.columns
    let rowFromTop = index / sheet.columns
    let cellX = column * sheet.cellWidth
    let cellY = height - ((rowFromTop + 1) * sheet.cellHeight)
    source.draw(
        in: NSRect(x: cellX, y: cellY + sheet.imageOffsetY, width: sheet.cellWidth, height: sheet.imageHeight),
        from: NSRect(origin: .zero, size: source.size),
        operation: .copy,
        fraction: 1
    )
    cell.title.draw(at: NSPoint(x: cellX + 10, y: cellY + sheet.imageHeight + 28), withAttributes: titleStyle)
    cell.viewLabel.draw(at: NSPoint(x: cellX + 10, y: cellY + sheet.imageHeight + 10), withAttributes: viewStyle)
    NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
    let border = NSBezierPath(rect: NSRect(x: cellX, y: cellY, width: sheet.cellWidth, height: sheet.cellHeight))
    border.lineWidth = 1
    border.stroke()
}

NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("could not encode contact sheet PNG\n", stderr)
    exit(1)
}
try png.write(to: outputURL, options: .atomic)
