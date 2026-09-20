# database/

Template default untuk setiap bot baru. Saat sebuah nomor pertama kali dibuat,
file di folder ini disalin ke `SESSION_DIR/<nomor>/`:

- `selfmode.json` : `{ "selfmode": false }` (false = semua orang boleh memakai bot)
- `welcome.json`  : `{}` lalu terisi lewat `.setwelcome`, `.setleave`, `.welcome`, `.leave`

Contoh isi `welcome.json` setelah dikonfigurasi:

```json
{
  "welcomeEnabled": true,
  "welcomeText": "Halo @user, selamat datang di @group",
  "leaveEnabled": true,
  "leaveText": "Sampai jumpa @user"
}
```
