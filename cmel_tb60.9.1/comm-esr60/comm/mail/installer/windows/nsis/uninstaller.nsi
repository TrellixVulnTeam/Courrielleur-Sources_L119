# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Required Plugins:
# AppAssocReg http://nsis.sourceforge.net/Application_Association_Registration_plug-in
# CityHash    http://dxr.mozilla.org/mozilla-central/source/other-licenses/nsis/Contrib/CityHash
# ShellLink   http://nsis.sourceforge.net/ShellLink_plug-in
# UAC         http://nsis.sourceforge.net/UAC_plug-in

; Set verbosity to 3 (e.g. no script) to lessen the noise in the build logs
!verbose 3

; 7-Zip provides better compression than the lzma from NSIS so we add the files
; uncompressed and use 7-Zip to create a SFX archive of it
SetDatablockOptimize on
SetCompress off
CRCCheck on

RequestExecutionLevel user

Unicode true
ManifestSupportedOS all
ManifestDPIAware true

!addplugindir ./

; Attempt to elevate Standard Users in addition to users that
; are a member of the Administrators group.
!define NONADMIN_ELEVATE

; prevents compiling of the reg write logging.
!define NO_LOG

!define MaintUninstallKey \
 "Software\Microsoft\Windows\CurrentVersion\Uninstall\MozillaMaintenanceService"

Var TmpVal
Var MaintCertKey

; Other included files may depend upon these includes!
; The following includes are provided by NSIS.
!include FileFunc.nsh
!include LogicLib.nsh
!include MUI.nsh
!include WinMessages.nsh
!include WinVer.nsh
!include WordFunc.nsh

!insertmacro GetSize
!insertmacro StrFilter
!insertmacro WordReplace

!insertmacro un.GetParent

; The following includes are custom.
!include branding.nsi
!include defines.nsi
!include common.nsh
!include locales.nsi

; This is named BrandShortName helper because we use this for software update
; post update cleanup.
VIAddVersionKey "FileDescription" "${BrandShortName} Helper"
VIAddVersionKey "OriginalFilename" "helper.exe"

!insertmacro AddHandlerValues
!insertmacro CleanVirtualStore
!insertmacro ElevateUAC
!insertmacro GetLongPath
!insertmacro GetPathFromString
!insertmacro InitHashAppModelId
!insertmacro IsHandlerForInstallDir
!insertmacro IsPinnedToTaskBar
!insertmacro IsUserAdmin
!insertmacro LogDesktopShortcut
!insertmacro LogQuickLaunchShortcut
!insertmacro LogStartMenuShortcut
!insertmacro PinnedToStartMenuLnkCount
!insertmacro RegCleanAppHandler
!insertmacro RegCleanMain
!insertmacro RegCleanUninstall
!insertmacro SetAppLSPCategories
!insertmacro SetBrandNameVars
!insertmacro UpdateShortcutAppModelIDs
!insertmacro UnloadUAC
!insertmacro WriteRegDWORD2
!insertmacro WriteRegStr2

!insertmacro un.ChangeMUIHeaderImage
!insertmacro un.CheckForFilesInUse
!insertmacro un.CleanUpdateDirectories
!insertmacro un.CleanVirtualStore
!insertmacro un.DeleteShortcuts
!insertmacro un.GetLongPath
!insertmacro un.GetSecondInstallPath
!insertmacro un.InitHashAppModelId
!insertmacro un.ManualCloseAppPrompt
!insertmacro un.ParseUninstallLog
!insertmacro un.RegCleanAppHandler
!insertmacro un.RegCleanFileHandler
!insertmacro un.RegCleanMain
!insertmacro un.RegCleanUninstall
!insertmacro un.RegCleanProtocolHandler
!insertmacro un.RemoveQuotesFromPath
!insertmacro un.RemovePrecompleteEntries
!insertmacro un.SetAppLSPCategories
!insertmacro un.SetBrandNameVars

!include shared.nsh

; Helper macros for ui callbacks. Insert these after shared.nsh
!insertmacro OnEndCommon
!insertmacro UninstallOnInitCommon

!insertmacro un.OnEndCommon
!insertmacro un.UninstallUnOnInitCommon

Name "${BrandFullName}"
OutFile "helper.exe"
!ifdef HAVE_64BIT_BUILD
  InstallDir "$PROGRAMFILES64\${RepertoireInstall}\"
!else
  InstallDir "$PROGRAMFILES32\${RepertoireInstall}\"
!endif
ShowUnInstDetails nevershow

################################################################################
# Modern User Interface - MUI

!define MUI_ABORTWARNING
!define MUI_ICON setup.ico
!define MUI_UNICON setup.ico
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_UNWELCOMEFINISHPAGE_BITMAP wizWatermark.bmp
; cm2v5
!define NO_UNINSTALL_SURVEY

; Use a right to left header image when the language is right to left
!ifdef ${AB_CD}_rtl
!define MUI_HEADERIMAGE_BITMAP_RTL wizHeaderRTL.bmp
!else
!define MUI_HEADERIMAGE_BITMAP wizHeader.bmp
!endif

/**
 * Uninstall Pages
 */
; Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.preWelcome
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.leaveWelcome
!insertmacro MUI_UNPAGE_WELCOME

; Custom Uninstall Confirm Page
UninstPage custom un.preConfirm

; Remove Files Page
!insertmacro MUI_UNPAGE_INSTFILES

; Finish Page

!insertmacro MUI_UNPAGE_FINISH

; Use the default dialog for IDD_VERIFY for a simple Banner
ChangeUI IDD_VERIFY "${NSISDIR}\Contrib\UIs\default.exe"

################################################################################
# Helper Functions

; This function is used to uninstall the maintenance service if the
; application currently being uninstalled is the last application to use the
; maintenance service.
Function un.UninstallServiceIfNotUsed
  ; $0 will store if a subkey exists
  ; $1 will store the first subkey if it exists or an empty string if it doesn't
  ; Backup the old values
  Push $0
  Push $1

  ; The maintenance service always uses the 64-bit registry on x64 systems
  ${If} ${RunningX64}
    SetRegView 64
  ${EndIf}

  ; Figure out the number of subkeys
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKLM "Software\Mozilla\MaintenanceService" $0
    ${If} "$1" == ""
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
  ${Loop}

  ; Restore back the registry view
  ${If} ${RunningX64}
    SetRegView lastUsed
  ${EndIf}

  ${If} $0 == 0
    ; Get the path of the maintenance service uninstaller.
    ; Look in both the 32-bit and 64-bit registry views.
    SetRegView 32
    ReadRegStr $1 HKLM ${MaintUninstallKey} "UninstallString"
    SetRegView lastused

    ${If} $1 == ""
    ${AndIf} ${RunningX64}
      SetRegView 64
      ReadRegStr $1 HKLM ${MaintUninstallKey} "UninstallString"
      SetRegView lastused
    ${EndIf}

    ; If the uninstall string does not exist, skip executing it
    ${If} $1 != ""
      ; $1 is already a quoted string pointing to the install path
      ; so we're already protected against paths with spaces
      nsExec::Exec "$1 /S"
    ${EndIf}
  ${EndIf}

  ; Restore the old value of $1 and $0
  Pop $1
  Pop $0
FunctionEnd

################################################################################
# Install Sections
; Empty section required for the installer to compile as an uninstaller
Section ""
SectionEnd

################################################################################
# Uninstall Sections

Section "Uninstall"
  SetDetailsPrint textonly
  DetailPrint $(STATUS_UNINSTALL_MAIN)
  SetDetailsPrint none

  ; Delete the app exe to prevent launching the app while we are uninstalling.
  ClearErrors
  ${DeleteFile} "$INSTDIR\${FileMainEXE}"
  ${If} ${Errors}
    ; If the user closed the application it can take several seconds for it to
    ; shut down completely. If the application is being used by another user we
    ; can still delete the files when the system is restarted.
    Sleep 5000
    ${DeleteFile} "$INSTDIR\${FileMainEXE}"
    ClearErrors
  ${EndIf}

  ; setup the application model id registration value
  ; ${un.InitHashAppModelId} "$INSTDIR" "Software\Mozilla\${AppName}\TaskBarIDs"
  ${un.InitHashAppModelId} "$INSTDIR" "Software\PAMELA\${AppName}\TaskBarIDs"

  SetShellVarContext current  ; Set SHCTX to HKCU
  ; ${un.RegCleanMain} "Software\Mozilla"
  ${un.RegCleanMain} "Software\PAMELA"
  ${un.RegCleanUninstall}
  ${un.DeleteShortcuts}
  ; suppression groupe de menus 'Courrielleur Mél'
  StrCpy $0 "$INSTDIR\uninstall\${SHORTCUTS_LOG}"
  ${If} ${FileExists} "$0"
    ${un.GetLongPath} "$SMPROGRAMS" $1
    ClearErrors
    ReadINIStr $2 "$0" "SMPROGRAMS" "RelativePathToDir"
    ${Unless} ${Errors}
      ${un.GetLongPath} "$1\$2" $2
      ${If} "$2" != ""
        ${If} ${FileExists} "$2"
          RmDir "$2"
        ${EndIf}
      ${EndIf}
    ${EndUnless}
  ${EndIf}  

  ; Unregister resources associated with Win7 taskbar jump lists.
  ${If} ${AtLeastWin7}
  ${AndIf} "$AppUserModelID" != ""
    ApplicationID::UninstallJumpLists "$AppUserModelID"
  ${EndIf}

  ; Remove the updates directory
  ${un.CleanUpdateDirectories} "Thunderbird" "Thunderbird\updates"

  ; Remove any app model id's stored in the registry for this install path
  ; DeleteRegValue HKCU "Software\Mozilla\${AppName}\TaskBarIDs" "$INSTDIR"
  DeleteRegValue HKCU "Software\PAMELA\${AppName}\TaskBarIDs" "$INSTDIR"
  ; DeleteRegValue HKLM "Software\Mozilla\${AppName}\TaskBarIDs" "$INSTDIR"
  DeleteRegValue HKLM "Software\PAMELA\${AppName}\TaskBarIDs" "$INSTDIR"

  ClearErrors
  ; WriteRegStr HKLM "Software\Mozilla" "${BrandShortName}InstallerTest" "Write Test"
  WriteRegStr HKLM "Software\PAMELA" "${BrandShortName}InstallerTest" "Write Test"
  ${If} ${Errors}
    StrCpy $TmpVal "HKCU" ; used primarily for logging
  ${Else}
    SetShellVarContext all  ; Set SHCTX to HKLM
    ; DeleteRegValue HKLM "Software\Mozilla" "${BrandShortName}InstallerTest"
    DeleteRegValue HKLM "Software\Mozilla" "${BrandShortName}InstallerTest"
    StrCpy $TmpVal "HKLM" ; used primarily for logging
    ; ${un.RegCleanMain} "Software\Mozilla"
    ${un.RegCleanMain} "Software\PAMELA"
    ${un.RegCleanUninstall}
    ${un.DeleteShortcuts}
  ${EndIf}

  ${un.RegCleanAppHandler} "Thunderbird.Url.mailto"
  ${un.RegCleanAppHandler} "Thunderbird.Url.news"
  ${un.RegCleanAppHandler} "ThunderbirdEML"
  ${un.RegCleanProtocolHandler} "mailto"
  ${un.RegCleanProtocolHandler} "news"
  ${un.RegCleanProtocolHandler} "nntp"
  ${un.RegCleanProtocolHandler} "snews"

  ClearErrors
  ReadRegStr $R9 HKCR "ThunderbirdEML" ""
  ; Don't clean up the file handlers if the ThunderbirdEML key still exists
  ; since there could be a second installation that may be the default file
  ; handler.
  ${If} ${Errors}
    ${un.RegCleanFileHandler}  ".eml"   "ThunderbirdEML"
    ${un.RegCleanFileHandler}  ".wdseml" "ThunderbirdEML"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\explorer\KindMap" ".wdseml"
    ; It doesn't matter if the value didn't exist
    ClearErrors
  ${EndIf}

  SetShellVarContext all  ; Set SHCTX to HKLM
  ; ${un.GetSecondInstallPath} "Software\Mozilla" $R9
  ${un.GetSecondInstallPath} "Software\PAMELA" $R9
  ${If} $R9 == "false"
    SetShellVarContext current  ; Set SHCTX to HKCU
    ; ${un.GetSecondInstallPath} "Software\Mozilla" $R9
    ${un.GetSecondInstallPath} "Software\PAMELA" $R9
  ${EndIf}

  StrCpy $0 "Software\Clients\Mail\${ClientsRegName}\shell\open\command"
  ReadRegStr $R1 HKLM "$0" ""
  ${un.RemoveQuotesFromPath} "$R1" $R1
  ${un.GetParent} "$R1" $R1

  ; Only remove the Clients\Mail and Clients\News key if it refers to this
  ; install location. The Clients\Mail & Clients\News keys are independent
  ; of the default app for the OS settings. The XPInstall base un-installer
  ; always removes these keys if it is uninstalling the default app and it
  ; will always replace the keys when installing even if there is another
  ; install of Thunderbird that is set as the
  ; default app. Now the keys are always updated on install but are only
  ; removed if they refer to this install location.
  ${If} "$INSTDIR" == "$R1"
    DeleteRegKey HKLM "Software\Clients\Mail\${ClientsRegName}"
    DeleteRegKey HKLM "Software\Clients\News\${ClientsRegName}"
    DeleteRegValue HKLM "Software\RegisteredApplications" "${AppRegNameMail}"
    DeleteRegValue HKLM "Software\RegisteredApplications" "${AppRegNameNews}"
  ${EndIf}

  StrCpy $0 "Software\Microsoft\Windows\CurrentVersion\App Paths\${FileMainEXE}"
  ${If} $R9 == "false"
    DeleteRegKey HKLM "$0"
    DeleteRegKey HKCU "$0"
  ${Else}
    ReadRegStr $R1 HKLM "$0" ""
    ${un.RemoveQuotesFromPath} "$R1" $R1
    ${un.GetParent} "$R1" $R1
    ${If} "$INSTDIR" == "$R1"
      WriteRegStr HKLM "$0" "" "$R9"
      ${un.GetParent} "$R9" $R1
      WriteRegStr HKLM "$0" "Path" "$R1"
    ${EndIf}
  ${EndIf}

  ; Remove directories and files we always control before parsing the uninstall
  ; log so empty directories can be removed.
  ${If} ${FileExists} "$INSTDIR\updates"
    RmDir /r /REBOOTOK "$INSTDIR\updates"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\defaults\shortcuts"
    RmDir /r /REBOOTOK "$INSTDIR\defaults\shortcuts"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\distribution"
    RmDir /r /REBOOTOK "$INSTDIR\distribution"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\removed-files"
    Delete /REBOOTOK "$INSTDIR\removed-files"
  ${EndIf}

  ; Application update won't add these files to the uninstall log so delete
  ; them if they still exist.
  ${If} ${FileExists} "$INSTDIR\MapiProxy_InUse.dll"
    Delete /REBOOTOK "$INSTDIR\MapiProxy_InUse.dll"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\mozMapi32_InUse.dll"
    Delete /REBOOTOK "$INSTDIR\mozMapi32_InUse.dll"
  ${EndIf}

  ; Remove files that may be left behind by the application in the
  ; VirtualStore directory.
  ${un.CleanVirtualStore}

  ; Only unregister the dll if the registration points to this installation
  ReadRegStr $R1 HKCR "CLSID\{0D68D6D0-D93D-4D08-A30D-F00DD1F45B24}\InProcServer32" ""
  ${If} "$INSTDIR\AccessibleMarshal.dll" == "$R1"
    ${UnregisterDLL} "$INSTDIR\AccessibleMarshal.dll"
  ${EndIf}

  ; Only unregister the dll if the registration points to this installation
  ReadRegStr $R1 HKCR "CLSID\${AccessibleHandlerCLSID}\InprocHandler32" ""
  ${If} "$INSTDIR\AccessibleHandler.dll" == "$R1"
    ${UnregisterDLL} "$INSTDIR\AccessibleHandler.dll"
  ${EndIf}

  ; Parse the uninstall log to unregister dll's and remove all installed
  ; files / directories this install is responsible for.
  ${un.ParseUninstallLog}

  ; Remove the uninstall directory that we control
  RmDir /r /REBOOTOK "$INSTDIR\uninstall"

  ; Remove the installation directory if it is empty
  RmDir "$INSTDIR"

  ; If thunderbird.exe was successfully deleted yet we still need to restart to
  ; remove other files create a dummy thunderbird.exe.moz-delete to prevent the
  ; installer from allowing an install without restart when it is required
  ; to complete an uninstall.
  ${If} ${RebootFlag}
    ; Admin is required to delete files on reboot so only add the moz-delete if
    ; the user is an admin. After calling UAC::IsAdmin $0 will equal 1 if the
    ; user is an admin.
    UAC::IsAdmin
    ${If} "$0" == "1"
      ${Unless} ${FileExists} "$INSTDIR\${FileMainEXE}.moz-delete"
        FileOpen $0 "$INSTDIR\${FileMainEXE}.moz-delete" w
        FileWrite $0 "Will be deleted on restart"
        Delete /REBOOTOK "$INSTDIR\${FileMainEXE}.moz-delete"
        FileClose $0
      ${EndUnless}
    ${EndIf}
  ${EndIf}

  ; Refresh desktop icons otherwise the start menu internet item won't be
  ; removed and other ugly things will happen like recreation of the app's
  ; clients registry key by the OS under some conditions.
  System::Call "shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)"

!ifdef MOZ_MAINTENANCE_SERVICE
  ; Get the path the allowed cert is at and remove it
  ; Keep this block of code last since it modifies the reg view
  ServicesHelper::PathToUniqueRegistryPath "$INSTDIR"
  Pop $MaintCertKey
  ${If} $MaintCertKey != ""
    ; Always use the 64bit registry for certs on 64bit systems.
    ${If} ${RunningX64}
      SetRegView 64
    ${EndIf}
    DeleteRegKey HKLM "$MaintCertKey"
    ${If} ${RunningX64}
      SetRegView lastused
    ${EndIf}
  ${EndIf}
  Call un.UninstallServiceIfNotUsed
!endif

SectionEnd

################################################################################
# Language

!insertmacro MOZ_MUI_LANGUAGE 'baseLocale'
!verbose push
!verbose 3
!include "overrideLocale.nsh"
!include "customLocale.nsh"
!verbose pop

; Set this after the locale files to override it if it is in the locale. Using
; " " for BrandingText will hide the "Nullsoft Install System..." branding.
BrandingText " "

################################################################################
# Page pre, show, and leave functions

Function un.preWelcome
  ${If} ${FileExists} "$INSTDIR\distribution\modern-wizard.bmp"
    Delete "$PLUGINSDIR\modern-wizard.bmp"
    CopyFiles /SILENT "$INSTDIR\distribution\modern-wizard.bmp" "$PLUGINSDIR\modern-wizard.bmp"
  ${EndIf}
FunctionEnd

Function un.leaveWelcome
  ${If} ${FileExists} "$INSTDIR\${FileMainEXE}"
    Banner::show /NOUNLOAD "$(BANNER_CHECK_EXISTING)"

    ; If the message window has been found previously give the app an additional
    ; five seconds to close.
    ${If} "$TmpVal" == "FoundMessageWindow"
      Sleep 5000
    ${EndIf}

    ${PushFilesToCheck}

    ${un.CheckForFilesInUse} $TmpVal

    Banner::destroy

    ; If there are files in use $TmpVal will be "true"
    ${If} "$TmpVal" == "true"
      ; If the message window is found the call to ManualCloseAppPrompt will
      ; abort leaving the value of $TmpVal set to "FoundMessageWindow".
      StrCpy $TmpVal "FoundMessageWindow"
      ${un.ManualCloseAppPrompt} "${WindowClass}" "$(WARN_MANUALLY_CLOSE_APP_UNINSTALL)"
      ; If the message window is not found set $TmpVal to "true" so the restart
      ; required message is displayed.
      StrCpy $TmpVal "true"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.preConfirm
  ${If} ${FileExists} "$INSTDIR\distribution\modern-header.bmp"
  ${AndIf} $hHeaderBitmap == ""
    Delete "$PLUGINSDIR\modern-header.bmp"
    CopyFiles /SILENT "$INSTDIR\distribution\modern-header.bmp" "$PLUGINSDIR\modern-header.bmp"
    ${un.ChangeMUIHeaderImage} "$PLUGINSDIR\modern-header.bmp"
  ${EndIf}

  ; Setup the unconfirm.ini file for the Custom Uninstall Confirm Page
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Settings" NumFields "3"

  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Type   "label"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Text   "$(UN_CONFIRM_UNINSTALLED_FROM)"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Left   "0"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Right  "-1"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Top    "5"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 1" Bottom "15"

  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" Type   "text"
  ; The contents of this control must be set as follows in the pre function
  ; ${MUI_INSTALLOPTIONS_READ} $1 "unconfirm.ini" "Field 2" "HWND"
  ; SendMessage $1 ${WM_SETTEXT} 0 "STR:$INSTDIR"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" State  ""
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" Left   "0"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" Right  "-1"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" Top    "17"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" Bottom "30"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 2" flags  "READONLY"

  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Type   "label"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Text   "$(UN_CONFIRM_CLICK)"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Left   "0"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Right  "-1"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Top    "130"
  WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 3" Bottom "150"

  ${If} "$TmpVal" == "true"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Type   "label"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Text   "$(SUMMARY_REBOOT_REQUIRED_UNINSTALL)"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Left   "0"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Right  "-1"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Top    "35"
    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Field 4" Bottom "45"

    WriteINIStr "$PLUGINSDIR\unconfirm.ini" "Settings" NumFields "4"
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(UN_CONFIRM_PAGE_TITLE)" "$(UN_CONFIRM_PAGE_SUBTITLE)"
  ; The Summary custom page has a textbox that will automatically receive
  ; focus. This sets the focus to the Install button instead.
  !insertmacro MUI_INSTALLOPTIONS_INITDIALOG "unconfirm.ini"
  GetDlgItem $0 $HWNDPARENT 1
  System::Call "user32::SetFocus(i r0, i 0x0007, i,i)i"
  ${MUI_INSTALLOPTIONS_READ} $1 "unconfirm.ini" "Field 2" "HWND"
  SendMessage $1 ${WM_SETTEXT} 0 "STR:$INSTDIR"
  !insertmacro MUI_INSTALLOPTIONS_SHOW
FunctionEnd

################################################################################
# Initialization Functions

Function .onInit
  ; Remove the current exe directory from the search order.
  ; This only effects LoadLibrary calls and not implicitly loaded DLLs.
  System::Call 'kernel32::SetDllDirectoryW(w "")'

  ; We need this set up for most of the helper.exe operations.
  ${UninstallOnInitCommon}
FunctionEnd

Function un.onInit
  ; Remove the current exe directory from the search order.
  ; This only effects LoadLibrary calls and not implicitly loaded DLLs.
  System::Call 'kernel32::SetDllDirectoryW(w "")'

  StrCpy $LANGUAGE 0

  ${un.UninstallUnOnInitCommon}

  !insertmacro InitInstallOptionsFile "unconfirm.ini"
FunctionEnd

Function .onGUIEnd
  ${OnEndCommon}
FunctionEnd

Function un.onGUIEnd
  ${un.OnEndCommon}
FunctionEnd
