; PrivacyRPC Installer - Clean Modern Design
Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define INSTALLMODE "{{install_mode}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUPRODUCTKEY "Software\${MANUFACTURER}\${PRODUCTNAME}"

Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${PRODUCTNAME}"
RequestExecutionLevel user

; Version info
VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME} Setup"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

; ===================== MUI SETTINGS =====================

; Icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
  !define MUI_UNICON "${INSTALLERICON}"
!endif

; Sidebar image for welcome/finish pages
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
  !define MUI_HEADERIMAGE_RIGHT
!endif

; Abort warning
!define MUI_ABORTWARNING

; Welcome page settings
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCTNAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of ${PRODUCTNAME} v${VERSION}.$\r$\n$\r$\nPrivacy-first Solana RPC proxy that shields your wallet activity by routing RPC traffic through a secure local proxy, scanning extensions for threats, and monitoring for suspicious RPC patterns.$\r$\n$\r$\nClick Next to continue."

; Finish page settings
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "${PRODUCTNAME} has been installed on your computer.$\r$\n$\r$\nClick Finish to close this wizard."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAINBINARYNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCTNAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create Desktop Shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

; ===================== PAGES =====================

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license_file"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ===================== LANGUAGES =====================
!insertmacro MUI_LANGUAGE "English"

; ===================== FUNCTIONS =====================

Function .onInit
  ; Make window wider - 600 wide, 450 tall
  System::Call 'user32::GetSystemMetrics(i 0) i .r0'
  System::Call 'user32::GetSystemMetrics(i 1) i .r1'
  IntOp $2 $0 - 600
  IntOp $2 $2 / 2
  IntOp $3 $1 - 450
  IntOp $3 $3 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $2, i $3, i 600, i 450, i 0x0040)'
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
FunctionEnd

; ===================== INSTALL SECTION =====================
Section "Install"
  SetOutPath $INSTDIR

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{@key}}"
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{@key}}"
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save install location
  WriteRegStr HKCU "${MANUPRODUCTKEY}" "" $INSTDIR

  ; Start menu shortcut
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; Registry info for Add/Remove Programs
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

; ===================== UNINSTALL SECTION =====================
Section "Uninstall"
  ; Remove files
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Remove directories
  {{#each resources_ancestors}}
    RMDir "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCTNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  ; Remove registry keys
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "${MANUPRODUCTKEY}"
SectionEnd
