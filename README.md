# Alyz Bot Web

Multi-bot hosting WhatsApp berbasis Node.js (ESM) dan Baileys. Siapa pun bisa membuka
web, memasukkan nomor WhatsApp, lalu mendapat **pairing code** (tanpa QR) untuk
menautkan botnya sendiri. Setiap nomor punya folder session sendiri.

Repo: `alixpepeng-sketch/alyz-bot`

## Fitur bot

| Perintah | Fungsi |
| --- | --- |
| `.menu` | Daftar fitur |
| `.rvo` | Reply pesan view once untuk mengambil ulang media |
| `.toptv` | Upload video dengan caption `.toptv`, dikirim sebagai PTV |
| `.fotolive` | Upload video dengan caption `.fotolive`, dikirim sebagai live photo (eksperimental) |
| `.kickall` | Keluarkan semua member non-admin. Grup saja, owner bot saja, bot harus admin |
| `.selfmode on/off`, `.self`, `.public` | Atur apakah bot hanya melayani owner |
| `.removebg` | Reply foto untuk hapus background (butuh `REMOVEBG_API_KEY`) |
| `.sticker` / `.s` | Foto atau video jadi sticker 512x512 |
| `.brat <teks>` | Sticker brat dengan watermark ALYZ BOT |
| `.setwelcome <teks>` / `.setleave <teks>` | Atur teks sambutan / perpisahan. Pakai `@user` dan `@group` |
| `.welcome on/off` / `.leave on/off` | Aktif atau matikan sambutan / perpisahan |
| `.ai` | Balasan tetap |

Aturan akses:

- **Owner bot** adalah akun WhatsApp yang menautkan bot (pesan dari akun itu sendiri).
- `.selfmode`, `.self`, `.public`, `.kickall`, `.setwelcome`, `.setleave`, `.welcome`, `.leave`
  hanya bisa dipakai owner bot, karena pengaturannya berlaku untuk seluruh bot itu.
- Fitur lain bisa dipakai semua orang selama selfmode `false` (default).
- Kalau selfmode `true`, bot hanya melayani owner bot dan `OWNER_NUMBER` (pemilik platform).

## Struktur

```
alyz-bot/
  index.js              express + static + pulihkan session saat start
  package.json
  .env.example
  Dockerfile            opsional (ffmpeg + font)
  render.yaml           opsional (Blueprint Render)
  database/             template default tiap bot baru
    selfmode.json       { "selfmode": false }
    welcome.json        {}
  public/
    index.html          web 2 step: landing lalu pairing
    style.css
    script.js
  src/
    bot.js              POST /pair, Map sessions, reconnect, welcome/leave, rate limit
    handler.js          routing perintah, cek selfmode dan owner
    baileys.js          pintu import Baileys
    config.js  logger.js  utils.js
    lib/brat-svg.js     pembuat SVG untuk .brat
    features/           satu file per fitur + index.js
```

Data per bot disimpan di `SESSION_DIR/<nomor>/`:

```
/var/data/session/62831xxxx/
  creds.json  app-state-*.json  pre-key-*.json ...   (dari Baileys)
  selfmode.json                                       { "selfmode": false }
  welcome.json                                        pengaturan welcome dan leave
```

## Menjalankan lokal

Butuh Node.js 20 atau lebih baru.

```bash
cp .env.example .env
npm install
npm start
```

Buka `http://localhost:3000`, klik **Mulai Bot**, masukkan nomor, lalu masukkan kode di
WhatsApp: **Pengaturan > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon**.

## Environment

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `OWNER_NUMBER` | `6283176204764` | Pemilik platform, melewati selfmode |
| `PORT` | `3000` | Diisi otomatis oleh Render |
| `SESSION_DIR` | `./session` | Folder session. Di Render pakai `/var/data/session` |
| `LOG_LEVEL` | `info` | `debug` juga menyalakan log Baileys |
| `REMOVEBG_API_KEY` | kosong | Wajib untuk `.removebg` |
| `MAX_SESSIONS` | `100` | Opsional, batas bot aktif per server |

## Deploy ke Render

### 1. Push ke GitHub

```bash
git init
git add .
git commit -m "Alyz Bot Web"
git branch -M main
git remote add origin https://github.com/alixpepeng-sketch/alyz-bot.git
git push -u origin main
```

### 2. Buat Web Service

1. Di Render pilih **New > Web Service**, hubungkan repo `alyz-bot`.
2. Runtime **Node**, Build Command `npm install`, Start Command `npm start`.
3. Tambahkan environment variable `NODE_VERSION` = `20` (atau lebih baru).
4. Isi `OWNER_NUMBER`, `LOG_LEVEL`, dan `REMOVEBG_API_KEY`.

### 3. Persistent Disk (wajib supaya bot tidak hilang)

Session harus disimpan di disk permanen. Tanpa disk, semua bot terputus dan harus
pairing ulang setiap kali service restart atau deploy ulang.

1. Buka tab **Disks**, tambah disk dengan Mount Path `/var/data` (1 GB cukup untuk awal).
2. Tambahkan environment variable `SESSION_DIR` = `/var/data/session`.

Catatan penting:

- Persistent Disk hanya tersedia di plan berbayar.
- Service di plan gratis akan tidur setelah beberapa menit tanpa trafik, sehingga semua
  bot ikut offline. Untuk hosting bot gunakan plan yang selalu aktif.
- Saat service start, semua bot yang sudah tertaut dipulihkan otomatis dari `SESSION_DIR`.

### Alternatif: Docker / Blueprint

Runtime Node bawaan Render tidak punya `ffmpeg` dan font sistem. Akibatnya sticker video
gagal dan teks `.brat` bisa tampil kosong atau kotak-kotak. Solusinya pakai runtime
**Docker** (file `Dockerfile` sudah disediakan) yang memasang `ffmpeg` dan font.
File `render.yaml` juga tersedia untuk membuat service beserta disk lewat Blueprint.

## Cara kerja multi-bot

- `POST /pair` menerima `{ "number": "628..." }`, membuat `SESSION_DIR/<nomor>`, menyalakan
  socket Baileys baru, menyimpannya di `Map sessions`, lalu mengembalikan kode pairing.
- Kalau nomor sudah punya socket aktif, socket itu dipakai ulang.
- Setiap socket punya handler `creds.update`, `messages.upsert`, dan `group-participants.update` sendiri.
- Koneksi putus akan disambung ulang setelah 3 detik. Kalau perangkat dikeluarkan dari
  WhatsApp (logged out), session dihapus dan nomor perlu pairing ulang.
- Rate limit 10 detik per IP pada `/pair` (IP diambil dari header `cf-connecting-ip` bila ada, jika tidak dari `req.ip`). Pairing yang tidak diselesaikan dalam 3 menit dibuang otomatis.
- Frontend memakai `fetch('/pair')` relatif, tanpa domain yang ditulis di kode.

## Catatan teknis

- `.fotolive`: Baileys belum punya API resmi untuk live photo. Fitur ini mengirim video
  dengan penanda motion photo milik protokol WhatsApp. Hasilnya bergantung pada versi
  WhatsApp penerima, dan bila tidak dikenali akan tampil sebagai video biasa.
- `.sticker` untuk video memakai `ffmpeg` (paket `ffmpeg-static` sebagai dependency opsional,
  atau `ffmpeg` sistem, atau path di `FFMPEG_PATH`). Durasi dipotong maksimal 6 detik.
- Baileys dipasang dengan versi `latest`. Kalau suatu update merusak API, kunci ke versi
  tertentu di `package.json` lalu deploy ulang.
- Gunakan bot dengan bijak. WhatsApp bisa membatasi nomor yang dinilai spam.
