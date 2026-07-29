; Electron Builder's NSIS template creates the desktop shortcut by default.
; A custom installer page is intentionally deferred: the bundled NSIS template
; does not insert custom Page commands from this include, and treats the
; resulting unused callbacks as fatal warnings.
