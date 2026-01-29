# Menufaz Tablet PDV (Android)

Wrapper Android (WebView) que trava o tablet em uma mesa via QR Code.

## Como baixar o APK
1. Acesse o GitHub Actions do repo.
2. Abra o workflow **Android Tablet PDV APK**.
3. Baixe o artifact:
   - `menufaz-tablet-pdv-debug` (sempre disponível)
   - `menufaz-tablet-pdv-release` (se secrets de assinatura estiverem configurados)

## Instalar via ADB
```bash
adb install -r app-debug.apk
```

## Fluxo do app
1. Primeira execução abre o scanner de QR Code.
2. QR válido precisa ter:
   - domínio `app.menufaz.com`
   - query `?mesa=`
   - exemplo: `https://app.menufaz.com/loja-x?mesa=10`
3. O app salva `slug`, `mesa` e abre sempre:
   - `https://app.menufaz.com/{slug}?mesa={numero}&tablet=1`

## Reset Admin (troca de mesa)
- Toque e segure por **5s** no texto “Mesa XX”.
- Digite o PIN configurado na aba **Configurações > Segurança** da loja.
- Se o PIN estiver vazio, o reset fica bloqueado.

## Observações
- Links externos são bloqueados (o WebView não sai de app.menufaz.com).
- O user-agent inclui: `MenufazTabletPDV/1.0`.
