# pure-point

A Windows and macOS slide editor built with Rust and Tauri. On Windows 10/11 x64, download and run [pure-point-Windows-x64-setup.exe](https://github.com/santa-s4nt4/pure-point/releases/latest/download/pure-point-Windows-x64-setup.exe), then open **pure-point** from Start. The installer uses Microsoft Edge WebView2 and downloads the runtime if needed. The Windows installer is unsigned. On macOS, open `pure-point.app`. Click the filename or the animated **P** beside it in the center of the title bar for New, Open, Save, Save As, Export PDF, Present, Undo, and Redo.

## Documents

On macOS, New and startup read `~/Library/CloudStorage/OneDrive-電通/zero/template.potx`. The editor opens a fresh **untitled.pptx** based on that template. New, Open, and opening a PPTX from Finder each create a document window. Use **⌘W** to close the active presentation. The first Save asks for a name and location. If that file is absent, the app starts with a built-in title slide. On Windows, the app looks for `zero\template.potx` under `%OneDriveCommercial%`. Use **Open with → pure-point** in File Explorer to open an existing PPTX. The template stays in OneDrive. A widescreen template uses a 1920 × 1080 design canvas, with editable position and dimensions in pixels. Font sizes are in PowerPoint points. Opening an existing presentation retains its page dimensions.

### Sharing a Dentsu OneDrive file

On Windows, **Share…** reveals a saved presentation in your work OneDrive folder in File Explorer. Use OneDrive’s context menu to choose the recipients and permissions.

On macOS, save the presentation in `~/Library/CloudStorage/OneDrive-電通`. The sharing control appears just before the panel buttons. **Share…** reveals the saved file in Finder. Control-click the file, choose OneDrive’s **Share** command, and select **People in 電通** and **Can edit** in link settings. Choose **Copy link**.

For direct **Copy link**, install PowerShell 7 for macOS and run the following command in Terminal. Then reopen the presentation. Microsoft handles sign-in and consent for delegated `Files.ReadWrite` access under your organization's policies. [PowerShell for macOS](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-macos) · [Microsoft Graph PowerShell installation](https://learn.microsoft.com/en-us/powershell/microsoftgraph/installation)

```sh
pwsh -NoProfile -Command 'Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Repository PSGallery'
```

For a synced file in a recognized Dentsu business account, **Copy link** requests an organization-only editing link. The app checks the cloud file against the saved copy and verifies the returned permissions before copying the URL. If direct sharing is unavailable, use the Finder option. OneDrive manages existing permissions on the file. [Microsoft Graph sharing links](https://learn.microsoft.com/en-us/graph/api/driveitem-createlink)

## Slides and layout

- Switch between the canvas and the slide overview with the controls at the bottom, or the grid button above the thumbnails. Double-click a slide in the overview to edit it. Pinch either view to zoom. The canvas supports up to 1600%, with two-finger scrolling to pan.
- The title bar shows the filename and save status. Drag its empty space to move the window, or double-click it to zoom and restore. Its three panel controls show or hide the slide navigator, Script, and the inspector. Drag the navigator’s right divider to resize the thumbnails.
- Open **Script** to edit the active slide’s speaker notes below the canvas. The panel starts closed.
- Use **Add slide** in the left slide navigator to choose **title** (centered), **header title** (at the top), or **title and content**. Each choice uses the corresponding layout and editable placeholders from the current slide master. Titles in new slides and new presentations start with 1.5 line spacing.
- With a slide selected, ↑ and ↓ navigate and Delete removes the selected slides. Select a layer to nudge it with the arrow keys.
- Shift-click a range of slides, or ⌘-click individual slides. Use **⌘C** and **⌘V**, or the thumbnail’s context menu, to copy and paste slides after the selected slides in presentation order. **⌘G** groups the selected slides in a named section. Right-click a thumbnail to move slides into a section, hide them, or delete them. Drag thumbnails to reorder them or drop them on a section. Click a section name to collapse it.
- Hidden slides remain accessible in both editing views and are skipped in presentations and PDF exports.
- Choose a column, row, square, or thirds grid in Design. Set margins, gutters, and spacing. Hold Option while moving objects to temporarily bypass snapping. Drag a numeric label or value in Design to adjust it on the canvas. Use ↑ and ↓ for fine steps, or hold Shift for larger steps.

## Objects and review

- Double-click a blank spot for a new Yu Gothic 16 pt text box that grows and shrinks as you type. Double-click existing text to place the caret at the pointer. Type a hyphen followed by a space at the start of a paragraph to begin a bulleted list. Tab and Shift-Tab indent or outdent the current paragraph or selected paragraphs. Click the canvas to finish. In Design, use **Underline** and **Strikethrough** independently or together, and adjust character and line spacing.
- Drag with the rectangle, ellipse, line, or callout tool to set the size. Rectangles start with square corners. Set **Corner radius (%)** in Design to round them. Callouts start oval. Choose Oval or Rectangle in Design and adjust **Corner radius (%)** for a rectangle. Double-click the callout to type, or drag its yellow diamond to move the tip.
- Select a line and choose **Curve** under **Design → Stroke → Line shape**. Double-click the line and select a point to change its curvature or drag its Bézier handles. Double-click a segment to add a vertex and press Escape to finish. Lines support solid and dashed strokes and arrowheads on either end.
- Drag a text-box corner to change its width and height independently. Image and video handles preserve their aspect ratio. In Design, align a single object or group to the slide, or align multiple objects to their shared bounds. Click a color swatch to adjust color and opacity directly on the canvas.
- Shift-click objects or drag an empty area to select multiple objects. The Layers tab supports multiple selection, nested groups, visibility, and locking. Drag layer rows to change their stacking order. Expand a group to work with its members.
- Copy a selection with **⌘C** and paste with **⌘V**, or use **Copy** and **Paste** in the canvas and layer menus. Pasting on another slide keeps the original positions. A second copy on the same slide is offset so you can select it.
- Press **⌘V** on the canvas to paste text or images from other apps. Text becomes an editable Yu Gothic 16 pt text box and keeps its line breaks. Copied pictures and screenshots become image objects embedded in the PPTX. While typing in a text box, **⌘V** pastes at the caret.
- Select an object and post from Comments, or right-click it and choose **Add comment**. The comment follows the object and is saved as a PowerPoint comment. You can also pin comments to a position on the slide.
- Insert an image with the image tool. Double-click the picture or choose **Crop image** from its right-click menu or **Design → Image**. Drag the crop edges or corners directly on the canvas. Drag inside the frame to reposition the image. Click outside or press Enter to apply, or press Escape to cancel. **Reset crop** restores the full image. The same menu and Design panel also offer **Replace image**.
- Insert a local movie with the video tool. On macOS, AVFoundation prepares compatible MP4 media for PowerPoint. H.264/AAC MOV files can retain their original compressed video and audio. Hover over a movie or focus it to play, seek, mute, and adjust volume. Drop another video onto its frame to replace it. For YouTube or Vimeo, use the link tool and paste a video URL. Online players require a connection and a video that permits embedding.

Windows imports the original video and uses WebView2 to generate the poster. Use a format the target machine can play, such as H.264 MP4. For PDF export on Windows, choose **Save as PDF** in the print dialog.

| Action | Mac shortcut | Windows shortcut |
| --- | --- | --- |
| New / Open | ⌘N / ⌘O | Ctrl+N / Ctrl+O |
| Save / Save As | ⌘S / ⇧⌘S | Ctrl+S / Ctrl+Shift+S |
| Export PDF | ⇧⌘E | Ctrl+Shift+E |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Shift+Z |
| Copy / Paste slides or objects | ⌘C / ⌘V | Ctrl+C / Ctrl+V |
| Group / Ungroup | ⌘G / ⇧⌘G | Ctrl+G / Ctrl+Shift+G |
| Flip selected objects horizontally | ⇧H (outside text entry) | Shift+H |
| Toggle layer visibility / lock | ⇧⌘H / ⇧⌘L | Ctrl+Shift+H / Ctrl+Shift+L |
| Select / Text / Rectangle / Ellipse / Line | V / T / R / O / L | V / T / R / O / L |
| Show layout grid | G | G |
| Nudge a selection | Arrow / Shift + arrow | Arrow / Shift + arrow |
| Finish text editing | ⌘Enter | Ctrl+Enter |
| End presentation | Esc | Esc |

Use **Ctrl+W** to close a Windows document and **Ctrl+Alt+P** to present. Ctrl-click adds individual items to a selection. Hold Alt while dragging to bypass snapping.

## File compatibility

The desktop app can open presentations larger than 512 MB. It keeps a private working copy on disk and reads embedded images and video as needed. Saving streams the original package parts into the new PPTX. The 512 MiB memory guard applies to uncompressed XML only.

The editor reads Latin and East Asian typefaces independently, including localized font names and fonts supplied by PowerPoint on this Mac. For missing glyphs, it uses the Japanese run's character set to choose an Office substitute when applicable, then falls back to the slide theme. Text edits preserve the original PowerPoint font names and formatting of surrounding runs.

Text, shapes, groups, review comments, sections, and hidden-slide state are stored in the PowerPoint package. Editing an imported deck preserves its original parts wherever possible. The editor approximates some imported features, including charts, SmartArt, effects, and animations. PDF uses the editor’s visible slide content. Video appears as a still. For matching typography on another computer, install the same fonts there. Video playback depends on the system decoder or the video provider.

## Development

Install Node.js 22 and stable Rust. On macOS install Xcode Command Line Tools. On Windows use the x64 MSVC Rust toolchain, Visual Studio Build Tools with **Desktop development with C++**, and Microsoft Edge WebView2. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

Run the desktop app from the project directory.

```sh
npm ci
npm run dev
```

On Windows, `npm run build` produces an NSIS installer in `src-tauri/target/release/bundle/nsis/`. On macOS it produces a locally signed `pure-point.app` in the project directory. The supplied icon artwork lives in `public/floating-P.png`, which Vite copies into `dist/` on every build.

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml --release
```

The UI tests use the installed Google Chrome. The browser development surface starts with an empty slide. The desktop app uses the local OneDrive template when available.

## Desktop releases

Each push to `main` builds the macOS universal app and Windows x64 installer on GitHub-hosted runners. Both platforms run the editor and Rust tests. The Windows job silently installs the EXE and exercises opening a PPTX, saving with Ctrl+S, and opening a new window with Ctrl+N in the installed app. Once both jobs pass, the publisher attaches `pure-point-macOS.zip` and `pure-point-Windows-x64-setup.exe` to the same GitHub Release. After a successful build, Actions tags the tested commit. The patch version increases by the first-parent commit distance since the base version in `package.json` was set. Rerunning a commit reuses its version. If GitHub reports it could not allocate the Apple Silicon build runner, the release is retried once. The workflow can also be run manually from Actions to download a build artifact. Release bundles use an ad-hoc signature.

If GitHub interrupts publication, the publisher retries and reuses any uploaded asset with the same SHA-256. To recover a previous tag build while its artifact is still available, open **Actions → Desktop release → Run workflow**, select `main`, and enter the original run ID in `recover_run_id`. The workflow verifies the build and tag, then publishes the original artifacts.

After a release is published, run the following on a Mac to download it and unpack the app on the Desktop.

```sh
archive=$(mktemp -t pure-point) &&
  curl -fL https://github.com/santa-s4nt4/pure-point/releases/latest/download/pure-point-macOS.zip -o "$archive" &&
  ditto -x -k "$archive" "$HOME/Desktop" &&
  rm "$archive"
```
