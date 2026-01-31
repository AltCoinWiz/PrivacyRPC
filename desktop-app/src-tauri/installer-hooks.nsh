; PrivacyRPC Modern Dark Installer Hooks
; Creates a sleek, modern installation experience

!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

; Dark theme colors
!define DARK_BG 0x0A0A0A
!define DARK_TEXT 0xFFFFFF
!define CYAN_ACCENT 0xF5F55A
!define DARK_SECONDARY 0x1A1A1A
!define GRAY_TEXT 0xAAAAAA

Var Dialog
Var LabelWelcome
Var LabelDesc
Var BgBrush

; Custom font
Var CustomFont
Var TitleFont

!macro NSIS_HOOK_PREINSTALL
  ; Resize and center the window (wider)
  System::Call 'user32::GetSystemMetrics(i 0) i .r0'
  System::Call 'user32::GetSystemMetrics(i 1) i .r1'
  IntOp $2 $0 - 650
  IntOp $2 $2 / 2
  IntOp $3 $1 - 500
  IntOp $3 $3 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $2, i $3, i 650, i 500, i 0x0040)'

  ; Set window title
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:PrivacyRPC Setup"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Installation complete - could add custom finish actions here
!macroend
