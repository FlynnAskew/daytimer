; ============================================================
;  DayTimer — custom NSIS installer script
;  Auto-included by electron-builder (it picks up build/installer.nsh).
; ============================================================

; ── Override electron-builder's default running-app check ──────
;
; The default macro (CHECK_APP_RUNNING) politely asks DayTimer to
; close, waits, then re-checks. DayTimer is an Electron app, so it
; runs as several processes (main + GPU + renderer + utility) with
; two windows (floating widget + dashboard). That check often can't
; confirm every process has exited inside its timeout, so it gives up
; and shows the confusing:
;
;   "DayTimer cannot be closed. Please close it manually and
;    click Retry to continue."
;
; ...dialog — which non-technical colleagues get stuck on.
;
; Instead we force-terminate the whole DayTimer process tree before
; copying files. DayTimer persists state continuously (Supabase +
; electron-store writes are synchronous), so a hard kill during an
; install / update is safe and loses nothing meaningful.
!macro customCheckAppRunning
  ; /f = force, /t = kill the whole process tree (Electron children).
  ; Errors (e.g. app not running) are ignored — Pop just clears the stack.
  nsExec::Exec 'taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  ; Brief pause so Windows releases file locks before files are written.
  Sleep 1000
!macroend
