import * as THREE from 'three';

export function pixelTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  paint(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Keep the painted pixel motifs, but sample them smoothly at camera angles.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export function woodTexture() {
  return pixelTexture(512, 512, ctx => {
    const colors = ['#d9b38c', '#dcb790', '#d4ac84', '#e0bd97', '#d7b089'];
    for (let row = 0; row < 16; row++) {
      const y = row * 32;
      ctx.fillStyle = colors[row % colors.length]; ctx.fillRect(0, y, 512, 32);
      ctx.fillStyle = '#c29a72'; ctx.fillRect(0, y, 512, 2);
      ctx.fillStyle = '#d8ac771f'; ctx.fillRect(0, y + 2, 512, 2);
      for (let x = 0; x < 512; x += 128) {
        const seam = (x + (row % 2) * 64) % 512;
        ctx.fillStyle = '#c49c75'; ctx.fillRect(seam, y, 2, 32);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#e0ae701c' : '#784c2810';
          ctx.fillRect(seam + 12 + i * 25, y + 9 + i * 6, 30 + (row * i) % 34, 2);
        }
      }
    }
  });
}

export function brickTexture() {
  return pixelTexture(512, 512, ctx => {
    ctx.fillStyle = '#cdc2b0'; ctx.fillRect(0, 0, 512, 512);
    const colors = ['#e8dfd0', '#e3dacc', '#ecdfd2', '#dfd5c5', '#f0e6d8', '#e6dccd'];
    for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
      const x = col * 128 + (row % 2) * 64, y = row * 64;
      ctx.fillStyle = colors[(row * 3 + col + 12) % colors.length]; ctx.fillRect(x + 3, y + 3, 122, 58);
      ctx.fillStyle = '#ffffff40'; ctx.fillRect(x + 6, y + 4, 116, 3);
      ctx.fillStyle = '#8a7a6624'; ctx.fillRect(x + 3, y + 58, 122, 3);
    }
  });
}

export function rugTexture(base: string, accent: string) {
  return pixelTexture(128, 96, ctx => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 96);
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    for (const inset of [3, 7, 12]) ctx.strokeRect(inset, inset, 128 - inset * 2, 96 - inset * 2);
    for (let x = 17; x < 115; x += 14) for (let y = 18; y < 84; y += 14) {
      ctx.fillStyle = accent; ctx.fillRect(x, y, 2, 6); ctx.fillRect(x - 2, y + 2, 6, 2);
      ctx.fillStyle = '#faf9f590'; ctx.fillRect(x + 5, y + 6, 2, 2);
    }
    ctx.strokeRect(42, 29, 44, 38);
  });
}

export function cityTexture() {
  return pixelTexture(256, 160, ctx => {
    ctx.fillStyle = '#f3ddd0'; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#faf9f5'; ctx.fillRect(0, 19, 57, 5); ctx.fillRect(177, 12, 66, 6);
    const colors = ['#d9a58f', '#cc937c', '#c2866e', '#e0b4a0'];
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 14; i++) {
      const x = i * 22 - layer * 9, h = 25 + ((i * 29 + layer * 47) % 75), y = 132 - h;
      ctx.fillStyle = colors[(i + layer) % 4]; ctx.fillRect(x, y, 17, h);
      ctx.fillRect(x + 7, y - 6, 3, 6);
      for (let wx = x + 3; wx < x + 15; wx += 5) for (let wy = y + 5; wy < 130; wy += 9) {
        ctx.fillStyle = (wx + wy) % 3 ? '#f6ebe4' : '#f3d9a8'; ctx.fillRect(wx, wy, 2, 4);
      }
    }
    ctx.fillStyle = '#e3dacc'; ctx.fillRect(0, 132, 256, 28);
    ctx.fillStyle = '#a8755f'; ctx.fillRect(0, 126, 256, 3);
    for (const x of [40, 198]) { ctx.fillRect(x, 98, 5, 40); ctx.fillRect(x - 2, 101, 9, 3); }
    ctx.strokeStyle = '#b5846e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 107); ctx.quadraticCurveTo(125, 152, 256, 106); ctx.stroke();
    for (let x = 4; x < 256; x += 12) { ctx.beginPath(); ctx.moveTo(x, 116); ctx.lineTo(x, 127); ctx.stroke(); }
    ctx.fillStyle = '#ffffff4a'; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(103, 0); ctx.lineTo(0, 99); ctx.lineTo(0, 62); ctx.fill();
  });
}

export function boardTexture() {
  return pixelTexture(256, 128, ctx => {
    ctx.fillStyle = '#d4a27f'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#3d3d3a'; ctx.font = 'bold 10px monospace'; ctx.fillText('CLAUDE OFFICE / FIELD NOTES', 11, 16);
    for (let i = 0; i < 13; i++) {
      const x = 13 + i % 5 * 48, y = 27 + Math.floor(i / 5) * 31;
      ctx.fillStyle = ['#faf9f5', '#bcd1ca', '#ebc6b4', '#cbcadb'][i % 4]; ctx.fillRect(x, y, i % 4 === 3 ? 30 : 22, 24);
      ctx.fillStyle = '#87867f'; ctx.fillRect(x + 4, y + 6, 12, 1); ctx.fillRect(x + 4, y + 10, 15, 1); ctx.fillRect(x + 4, y + 14, 9, 1);
      ctx.fillStyle = '#d97757'; ctx.fillRect(x + 10, y, 3, 3);
    }
    ctx.fillStyle = '#faf9f5'; ctx.fillRect(99, 26, 38, 61);
    ctx.strokeStyle = '#788c5d'; ctx.lineWidth = 1;
    ctx.strokeRect(105, 34, 25, 13); ctx.strokeRect(105, 65, 25, 13);
    ctx.beginPath(); ctx.moveTo(117, 47); ctx.lineTo(117, 65); ctx.stroke();
  });
}

export function screenTexture(color: string, title: string) {
  return pixelTexture(128, 96, ctx => {
    ctx.fillStyle = '#1f1e1d'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#30302e'; ctx.fillRect(0, 0, 128, 12);
    ctx.fillStyle = '#b0aea5'; ctx.font = '7px monospace'; ctx.fillText(title.toUpperCase(), 7, 9);
    for (let row = 0; row < 11; row++) {
      const offset = row % 3 * 5;
      ctx.fillStyle = color; ctx.globalAlpha = row % 3 === 0 ? 0.95 : 0.65;
      ctx.fillRect(8 + offset, 19 + row * 6, 22 + (row * 13) % 72, 2);
      ctx.fillStyle = '#d97757'; ctx.fillRect(4, 19 + row * 6, 2, 2);
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#d97757'; ctx.fillRect(8, 87, 4, 4);
  });
}
