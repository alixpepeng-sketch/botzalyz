// Membuat SVG sticker brat: latar putih, teks hitam tebal, watermark kecil.
// Fungsi murni tanpa dependency supaya mudah dites.

const CANVAS = 512;
const PADDING = 28;
const WATERMARK_SPACE = 46;
const CHAR_WIDTH = 0.62; // perkiraan lebar rata-rata karakter bold sans dalam em
const LINE_HEIGHT = 1.12;
const FONT_FAMILY = "Arial, Helvetica, 'Liberation Sans', 'DejaVu Sans', sans-serif";

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapWords(words, maxChars) {
  const lines = [];
  let line = '';
  for (let word of words) {
    // Kata yang lebih panjang dari satu baris dipotong paksa.
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Cari ukuran font terbesar yang masih muat di kanvas.
export function layoutBrat(text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const longest = Math.max(1, ...words.map((w) => w.length));
  const availW = CANVAS - PADDING * 2;
  const availH = CANVAS - PADDING - WATERMARK_SPACE;

  let last = null;
  // Pass pertama: jangan potong kata. Pass kedua: boleh potong kata.
  for (const keepWords of [true, false]) {
    for (let size = 150; size >= 18; size -= 2) {
      const maxChars = Math.max(1, Math.floor(availW / (size * CHAR_WIDTH)));
      if (keepWords && maxChars < longest) continue;
      const lines = wrapWords(words, maxChars);
      last = { size, lineHeight: size * LINE_HEIGHT, lines };
      if (lines.length * size * LINE_HEIGHT <= availH) return last;
    }
  }
  return last;
}

export function buildBratSvg(text) {
  const { size, lineHeight, lines } = layoutBrat(text);
  const firstBaseline = PADDING + size * 0.86;

  const rows = lines
    .map((line, i) => {
      const y = (firstBaseline + i * lineHeight).toFixed(1);
      return `<text x="${PADDING}" y="${y}" font-size="${size}">${escapeXml(line)}</text>`;
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    `<rect width="${CANVAS}" height="${CANVAS}" fill="#ffffff"/>`,
    `<g font-family="${FONT_FAMILY}" font-weight="700" fill="#000000">${rows}</g>`,
    `<text x="${CANVAS / 2}" y="${CANVAS - 20}" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#000000" fill-opacity="0.55" text-anchor="middle" letter-spacing="3">ALYZ BOT</text>`,
    '</svg>',
  ].join('');
}
