import AppKit
import Foundation

struct Cell: Decodable {
    let sourcePath: String
    let title: String
    let viewLabel: String
}

struct Sheet: Decodable {
    let width: Int
    let cellWidth: Int
    let cellHeight: Int
    let imageHeight: Int
    let imageOffsetY: Int
    let headerHeight: Int
    let cells: [Cell]
}

guard CommandLine.arguments.count == 3 else {
    fputs("usage: assemble-contact-sheet.swift manifest.json output.png\n", stderr)
    exit(2)
}

let manifestURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let sheet = try JSONDecoder().decode(Sheet.self, from: Data(contentsOf: manifestURL))
guard sheet.cells.count % 4 == 0 else {
    fputs("contact sheet cell count must be divisible by four\n", stderr)
    exit(2)
}

let rows = sheet.cells.count / 4
let height = rows * sheet.cellHeight
guard sheet.width == sheet.cellWidth * 4 else {
    fputs("contact sheet width must equal four cell widths\n", stderr)
    exit(2)
}

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
NSColor(calibratedWhite: 0.075, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: sheet.width, height: height).fill()

let titleStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 14, weight: .regular),
    .foregroundColor: NSColor(calibratedRed: 0.95, green: 0.78, blue: 0.28, alpha: 1),
]
let viewStyle: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
    .foregroundColor: NSColor(calibratedWhite: 0.8, alpha: 1),
]

for (index, cell) in sheet.cells.enumerated() {
    guard let source = NSImage(contentsOfFile: cell.sourcePath) else {
        fputs("could not load witness image: \(cell.sourcePath)\n", stderr)
        exit(1)
    }
    let column = index % 4
    let rowFromTop = index / 4
    let cellX = column * sheet.cellWidth
    let cellY = height - ((rowFromTop + 1) * sheet.cellHeight)
    let imageRect = NSRect(
        x: cellX,
        y: cellY + sheet.imageOffsetY,
        width: sheet.cellWidth,
        height: sheet.imageHeight
    )
    source.draw(
        in: imageRect,
        from: NSRect(origin: .zero, size: source.size),
        operation: .copy,
        fraction: 1
    )

    let labelY = cellY + sheet.imageOffsetY + sheet.imageHeight + 13
    cell.title.draw(
        at: NSPoint(x: cellX + 12, y: labelY),
        withAttributes: titleStyle
    )
    cell.viewLabel.draw(
        at: NSPoint(x: cellX + 280, y: labelY + 1),
        withAttributes: viewStyle
    )

    NSColor(calibratedWhite: 0.25, alpha: 1).setStroke()
    let border = NSBezierPath(rect: NSRect(
        x: cellX,
        y: cellY,
        width: sheet.cellWidth,
        height: sheet.cellHeight
    ))
    border.lineWidth = 1
    border.stroke()
}

NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("could not encode contact sheet PNG\n", stderr)
    exit(1)
}
try png.write(to: outputURL, options: .atomic)
