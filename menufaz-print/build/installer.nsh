!macro customUnInstall
  ; Remove startup registry entries from legacy/current names
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Integracao FULL"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "menufaz-print"

  ; Remove user/app data folders from current and legacy builds
  RMDir /r "$APPDATA\Integracao FULL"
  RMDir /r "$APPDATA\menufaz-print"
  RMDir /r "$LOCALAPPDATA\Integracao FULL"
  RMDir /r "$LOCALAPPDATA\menufaz-print"
!macroend
