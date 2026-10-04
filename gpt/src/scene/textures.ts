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
  // Polished pale concrete with wide expansion joints.
  return pixelTexture(512,512,ctx=>{ctx.fillStyle='#f1f1f1';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#dedede';ctx.lineWidth=1;for(let i=0;i<=512;i+=128){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,512);ctx.moveTo(0,i);ctx.lineTo(512,i);ctx.stroke()}});
}
export function brickTexture() {
  return pixelTexture(512,512,ctx=>{ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,512);ctx.fillStyle='#ededed';for(let i=0;i<512;i+=128){ctx.fillRect(i,0,1,512);ctx.fillRect(0,i,512,1)}});
}

export function rugTexture(base:string,accent:string){return pixelTexture(128,96,ctx=>{ctx.fillStyle='#171717';ctx.fillRect(0,0,128,96);ctx.strokeStyle='#4d4d4d';ctx.lineWidth=1;ctx.strokeRect(4,4,120,88);ctx.strokeRect(9,9,110,78);ctx.fillStyle='#ececec';ctx.fillRect(58,39,12,18);ctx.fillRect(54,43,20,10)})}

export function cityTexture() {
  return pixelTexture(256, 160, ctx => {
    // A soft blue-to-peach gradient sky behind a hazy skyline.
    const sky = ctx.createLinearGradient(0, 0, 256, 160);
    sky.addColorStop(0, '#9dbcff'); sky.addColorStop(.45, '#d9c4f7'); sky.addColorStop(.75, '#ffc9d6'); sky.addColorStop(1, '#ffd9ae');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#ffffff8c'; ctx.fillRect(0, 19, 57, 5); ctx.fillRect(177, 12, 66, 6);
    const colors = ['#8f9fd6', '#a39bd8', '#7f93cf', '#b3a8de'];
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 14; i++) {
      const x = i * 22 - layer * 9, h = 25 + ((i * 29 + layer * 47) % 75), y = 132 - h;
      ctx.fillStyle = colors[(i + layer) % 4]; ctx.fillRect(x, y, 17, h);
      ctx.fillRect(x + 7, y - 6, 3, 6);
      for (let wx = x + 3; wx < x + 15; wx += 5) for (let wy = y + 5; wy < 130; wy += 9) {
        ctx.fillStyle = (wx + wy) % 3 ? '#dfe4fb' : '#ffe9c2'; ctx.fillRect(wx, wy, 2, 4);
      }
    }
    ctx.fillStyle = '#c9c4ee'; ctx.fillRect(0, 132, 256, 28);
    ctx.fillStyle = '#6f7fc0'; ctx.fillRect(0, 126, 256, 3);
    for (const x of [40, 198]) { ctx.fillRect(x, 98, 5, 40); ctx.fillRect(x - 2, 101, 9, 3); }
    ctx.strokeStyle = '#7f8cc8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 107); ctx.quadraticCurveTo(125, 152, 256, 106); ctx.stroke();
    for (let x = 4; x < 256; x += 12) { ctx.beginPath(); ctx.moveTo(x, 116); ctx.lineTo(x, 127); ctx.stroke(); }
    ctx.fillStyle = '#ffffff4a'; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(103, 0); ctx.lineTo(0, 99); ctx.lineTo(0, 62); ctx.fill();
  });
}

export function boardTexture() {
  return pixelTexture(256, 128, ctx => {
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px monospace'; ctx.fillText('GPT OFFICE / BUILD TOGETHER', 11, 16);
    for (let i = 0; i < 13; i++) {
      const x = 13 + i % 5 * 48, y = 27 + Math.floor(i / 5) * 31;
      ctx.fillStyle = ['#ffffff', '#d9d9d9', '#b9c8ff', '#f4f4f4'][i % 4]; ctx.fillRect(x, y, i % 4 === 3 ? 30 : 22, 24);
      ctx.fillStyle = '#8f8f8f'; ctx.fillRect(x + 4, y + 6, 12, 1); ctx.fillRect(x + 4, y + 10, 15, 1); ctx.fillRect(x + 4, y + 14, 9, 1);
      ctx.fillStyle = '#10a37f'; ctx.fillRect(x + 10, y, 3, 3);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(99, 26, 38, 61);
    ctx.strokeStyle = '#5d5d5d'; ctx.lineWidth = 1;
    ctx.strokeRect(105, 34, 25, 13); ctx.strokeRect(105, 65, 25, 13);
    ctx.beginPath(); ctx.moveTo(117, 47); ctx.lineTo(117, 65); ctx.stroke();
  });
}

export function screenTexture(color: string, title: string) {
  return pixelTexture(128, 96, ctx => {
    // A dark chat window: alternating reply and prompt bubbles.
    ctx.fillStyle = '#212121'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#171717'; ctx.fillRect(0, 0, 128, 12);
    ctx.fillStyle = '#b4b4b4'; ctx.font = '7px monospace'; ctx.fillText(title.toUpperCase(), 7, 9);
    for (let row = 0; row < 11; row++) {
      const prompt = row % 4 === 3, width = 22 + (row * 13) % 60;
      ctx.fillStyle = prompt ? '#3a3a3a' : '#ececec'; ctx.globalAlpha = prompt ? 1 : row % 3 === 0 ? 0.95 : 0.6;
      ctx.fillRect(prompt ? 120 - width : 8, 19 + row * 6, width, prompt ? 4 : 2);
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#2f2f2f'; ctx.fillRect(6, 85, 116, 8);
    ctx.fillStyle = color; ctx.fillRect(112, 87, 6, 4);
  });
}
