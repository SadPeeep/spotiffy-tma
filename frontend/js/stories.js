export async function shareTrackToStory(track) {
  const tg = window.Telegram?.WebApp;
  if (!tg?.shareToStory) { alert('Sharing not supported in your Telegram version.'); return; }

  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#121212'); gradient.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const img = await loadImage(track.cover_url);
    const size = 800, x = (canvas.width - size) / 2, y = 400;
    ctx.shadowColor = 'rgba(29,185,84,0.4)'; ctx.shadowBlur = 60;
    roundedImage(ctx, img, x, y, size, size, 24);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center';
    wrapText(ctx, track.title, canvas.width / 2, y + size + 100, 900, 85);
    ctx.fillStyle = '#B3B3B3'; ctx.font = '52px sans-serif';
    ctx.fillText(track.artist, canvas.width / 2, y + size + 230);
    drawEqualizer(ctx, canvas.width / 2 - 200, y + size + 290, 400, 60);
    ctx.fillStyle = '#1DB954'; ctx.font = 'bold 48px sans-serif';
    ctx.fillText('\u266B Spotiffy', canvas.width / 2, canvas.height - 120);
    ctx.strokeStyle = '#1DB954'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(100, canvas.height - 150); ctx.lineTo(canvas.width - 100, canvas.height - 150); ctx.stroke();
  } catch {
    ctx.fillStyle = '#1DB954'; ctx.font = 'bold 72px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(track.title, canvas.width / 2, canvas.height / 2);
  }

  tg.shareToStory(canvas.toDataURL('image/jpeg', 0.9), {
    text: `\u0421\u043b\u0443\u0448\u0430\u044e ${track.title} \u2014 ${track.artist} \u0432 Spotiffy!`,
    widget_link: {
      url: `https://t.me/${window.BOT_USERNAME || 'your_bot'}/app?startapp=track_${track.id}`,
      name: '\u0421\u043b\u0443\u0448\u0430\u0442\u044c \u0442\u0440\u0435\u043a',
    },
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });
}

function roundedImage(ctx, img, x, y, w, h, r) {
  ctx.save(); ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  ctx.clip(); ctx.drawImage(img, x, y, w, h); ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' '); let line = '';
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') { ctx.fillText(line, x, y); line = word + ' '; y += lineHeight; }
    else line = test;
  }
  ctx.fillText(line, x, y);
}

function drawEqualizer(ctx, x, y, width, height) {
  const barCount = 20, barWidth = width / barCount - 3;
  ctx.fillStyle = '#1DB954';
  for (let i = 0; i < barCount; i++) {
    const bh = Math.random() * height;
    ctx.beginPath(); ctx.roundRect(x + i * (barWidth + 3), y + height - bh, barWidth, bh, 3); ctx.fill();
  }
}
