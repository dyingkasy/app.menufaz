# Menufaz Print Delphi

Agente local Windows para impressao automatica do Menufaz.

## Build

Delphi 10.1 Berlin, Win32, Debug:

```bat
call "C:\Program Files (x86)\Embarcadero\Studio\18.0\bin\rsvars.bat"
MSBuild.exe MenufazPrint.dproj /t:Build /p:Config=Debug /p:Platform=Win32
```

Saida:

```text
Win32\Debug\MenufazPrint.exe
```

## Compatibilidade

O app usa o mesmo arquivo de configuracao do agente Electron:

```text
%APPDATA%\Menufaz Print\config.json
```

Isso preserva Merchant ID, API URL, impressora principal, estacoes, impressoras por estacao, token, machineId e autostart.

## Impressao

A impressao e feita em RAW via Winspool, enviando texto ESC/POS em CP860 diretamente para a impressora configurada.
