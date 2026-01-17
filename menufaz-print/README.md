# Menufaz Print (Local Windows App)

Local Electron app for automatic order printing. It runs on Windows, registers with the Menufaz API, lists installed printers, and prints jobs in the background.

## Requirements
- Node.js 18+
- Windows build tools for native modules (required by `printer`)

## Install
```bash
cd menufaz-print
npm install
```

## Run in dev
```bash
npm run dev
```

## Config
The app reads `config.json` from:
1) the current working directory, or
2) the Electron userData folder.

You can also pass arguments:
```bash
npm run dev -- --merchantId=YOUR_ID --apiUrl=http://localhost:3001
```

Example config:
```json
{
  "merchantId": "YOUR_MERCHANT_ID",
  "machineId": "",
  "printToken": "",
  "apiUrl": "http://localhost:3001",
  "printerName": ""
}
```

## Build for Windows
```bash
npm run dist
```

The installer will be created by `electron-builder` (NSIS target).

## GitHub Actions (Windows build)
The repo includes a workflow to build the Windows installer on `windows-latest`.

Trigger:
- Push to `main`, or
- Manual run via **Actions → Menufaz Print Windows Build → Run workflow**.

Artifact:
- Name: `menufaz-print-installer`
- Path: `menufaz-print/dist/**/*.exe`
- The NSIS installer is the `.exe` generated in `dist` (ex: `Menufaz Print Setup x.y.z.exe`).

## How it works
1) On start, the app loads `merchantId` and generates a unique `machineId`.
2) It registers in the API:
   - `POST /api/print/register` with `{ merchantId, machineId }`
3) It stores `printToken`, `storeName`, and starts polling:
   - `GET /api/print/jobs?merchantId=...` (Authorization: Bearer printToken)
4) It prints each job and marks as printed:
   - `POST /api/print/jobs/:id/printed`

## Test local printing
1) Select a printer in the UI.
2) Click **Print test**.

If the printer supports ESC/POS, the app sends a cut command at the end.

## Notes
- The app only prints for the configured `merchantId`.
- All requests use the `printToken` in the Authorization header.
- If you remove the config file, the app will ask for the Merchant ID again.
