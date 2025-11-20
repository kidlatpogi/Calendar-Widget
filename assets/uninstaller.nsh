; Custom NSIS Uninstaller Script for Calendar Widget
; This script provides an option to keep or delete user data during uninstall

; Macro called at the start of uninstaller initialization
!macro customUnInit
    ; Close the Calendar Widget application if it's running
    DetailPrint "Closing Calendar Widget application..."
    
    ; Try to gracefully close the app first
    ExecWait 'taskkill /F /IM "Calendar Widget.exe" /T' $0
    
    ; Also try to close any related electron processes
    ExecWait 'taskkill /F /FI "WINDOWTITLE eq Calendar Widget*" /T' $0
    
    ; Wait a moment for processes to fully close
    Sleep 1000
    
    ; Show dialog asking user if they want to keep or delete data
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Do you want to delete all Calendar Widget data?$\n$\nThis includes:$\n- Settings and configuration$\n- Calendar data$\n- Window positions$\n$\nClick 'Yes' to DELETE all data$\nClick 'No' to KEEP your data (recommended if you plan to reinstall)" IDYES deleteData IDNO keepData
    
    deleteData:
        ; Store choice in registry
        WriteRegStr HKCU "Software\Calendar Widget" "UninstallDeleteData" "1"
        Goto endChoice
    
    keepData:
        ; Store choice in registry
        WriteRegStr HKCU "Software\Calendar Widget" "UninstallDeleteData" "0"
        Goto endChoice
    
    endChoice:
!macroend

; Macro called after uninstall completes successfully
!macro customUnFinish
    ; Read the choice from registry into a temporary variable
    ReadRegStr $0 HKCU "Software\Calendar Widget" "UninstallDeleteData"
    
    ; Check if user wants to delete data (default to keep if not found)
    StrCmp $0 "1" deleteDataChoice keepDataChoice
    
    deleteDataChoice:
        ; User wants to delete all data
        DetailPrint "Removing user data and registry entries..."
        
        ; Try both possible userData directory names (productName and appId)
        StrCpy $1 "$APPDATA\Calendar Widget"
        StrCpy $2 "$APPDATA\com.kidlatpogi.calendarwidget"
        
        ; Check and delete Calendar Widget directory
        IfFileExists "$1\*.*" 0 +3
            RMDir /r "$1"
            DetailPrint "Deleted user data directory: $1"
        
        ; Check and delete com.kidlatpogi.calendarwidget directory
        IfFileExists "$2\*.*" 0 +3
            RMDir /r "$2"
            DetailPrint "Deleted user data directory: $2"
        
        ; Clean up auto-launch registry entries
        ; Remove from HKCU (Current User) Run key
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Calendar Widget"
        
        ; Also try removing with appId
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.kidlatpogi.calendarwidget"
        
        ; Remove from HKLM (Local Machine) Run key if it exists (requires admin, but try anyway)
        DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Calendar Widget"
        DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "com.kidlatpogi.calendarwidget"
        
        ; Remove application registry keys
        DeleteRegKey HKCU "Software\Calendar Widget"
        DeleteRegKey HKCU "Software\com.kidlatpogi.calendarwidget"
        
        DetailPrint "All user data and registry entries have been deleted."
        MessageBox MB_OK|MB_ICONINFORMATION "Calendar Widget has been uninstalled and all data has been removed."
        Goto endDataChoice
    
    keepDataChoice:
        ; User wants to keep data
        DetailPrint "User data has been preserved in %APPDATA%"
        MessageBox MB_OK|MB_ICONINFORMATION "Calendar Widget has been uninstalled.$\n$\nYour data has been preserved in:$\n%APPDATA%\Calendar Widget"
        Goto endDataChoice
    
    endDataChoice:
!macroend
