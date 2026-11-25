# pure-point

A macOS slide editor built with Rust, Tauri, and WebKit. Open `pure-point.app` to start. Click the animated **P** above the slide navigator for New, Open, Save, Save As, Export PDF, Present, Undo, and Redo.

## Documents

On this Mac, New and startup read `~/Library/CloudStorage/OneDrive-電通/zero/template.potx`. The editor opens a fresh **untitled.pptx** based on that template. The first Save asks for a name and location. The template stays in OneDrive. A widescreen template uses a 1920 × 1080 design canvas, with editable position and dimensions in pixels. Font sizes are in PowerPoint points. Opening an existing presentation retains its page dimensions.

## Slides and layout

- Switch between the canvas and the slide overview with the controls at the bottom, or the grid button above the thumbnails. Double-click a slide in the overview to edit it. Pinch either view to zoom. The canvas supports up to 1600%, with two-finger scrolling to pan.
- Drag the divider on the right edge of the navigator to resize the thumbnails. The panel button in the status bar shows or hides the inspector.
- With the slide selected, use ↑ and ↓ to move through the deck. Select a layer to nudge it with the arrow keys.
- Shift-click a range of slides, or ⌘-click individual slides. **New section** groups that selection. Right-click a thumbnail to move slides into a section, hide them, or delete them. Drag thumbnails to reorder them or drop them on a section. Click a section name to collapse it.
- Hidden slides remain accessible in both editing views and are skipped in presentations and PDF exports.
- Choose a column, row, square, or thirds grid in Design. Set margins, gutters, and spacing. Hold Option while moving objects to temporarily bypass snapping.

## Objects and review

- Double-click an empty spot to start writing, or double-click existing text to edit it. Select text to choose from the fonts and typefaces installed on this Mac.
- Shift-click objects or drag an empty area to select multiple objects. The Layers tab supports multiple selection, nested groups, visibility, and locking. Expand a group to work with its members.
- Comments belong to a slide and are saved inside the PPTX. Post from the Comments tab, or use its pin button and click the canvas to choose a location.
- Insert an image with the image tool. Double-click an existing image to replace it in its frame.
- Insert a local movie with the video tool. Hover over it or focus it to play, seek, mute, and adjust volume. Drop another video onto its frame to replace it. For YouTube or Vimeo, use the link tool and paste a video URL. Online players require a connection and a video that permits embedding.

| Action | Mac shortcut |
| --- | --- |
| New / Open | ⌘N / ⌘O |
| Save / Save As | ⌘S / ⇧⌘S |
| Export PDF | ⇧⌘E |
| Undo / Redo | ⌘Z / ⇧⌘Z |
| Group / Ungroup | ⌘G / ⇧⌘G |
| Toggle layer visibility / lock | ⇧⌘H / ⇧⌘L |
| Select / Text / Rectangle / Ellipse | V / T / R / O |
| Show layout grid | G |
| Nudge a selection | Arrow / Shift + arrow |
| Finish text editing | ⌘Enter |
| End presentation | Esc |

## File compatibility

Text, shapes, groups, review comments, sections, and hidden-slide state are stored in the PowerPoint package. Editing an imported deck preserves its original parts wherever possible. The editor approximates some imported features, including charts, SmartArt, effects, and animations. PDF uses the editor’s visible slide content; video appears as a still. For matching typography on another computer, install the same fonts there. Video playback depends on the system decoder or the video provider.

## Development

Install Rust, Node.js, and Xcode Command Line Tools on macOS. To run the desktop app:

```sh
npm ci
npm run dev
```

`npm run build` produces a locally signed `pure-point.app` in the project directory. The supplied icon artwork lives in `public/floating-P.png`, which Vite copies into `dist/` on every build.

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml --release
```

The UI tests use the installed Google Chrome. The browser development surface starts with an empty slide. The desktop app reads the local OneDrive template.
