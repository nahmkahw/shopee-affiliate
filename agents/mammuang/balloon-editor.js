// balloon-editor.js — interactive balloon overlay on generated image
// initBalloonEditor(container, imgUrl, speech, template)
// getBalloonParams() → {bxN,byN,bwN,bhN,txN,tyN,template,text, ...productParams}
(function () {
  const HANDLE_R = 7, TAIL_R = 10;
  let S = null, canvas, ctx, img, drag;

  function scale() { return S ? S.dispW / S.imgW : 1; }

  function wrapLines(text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    }
    return out;
  }

  function drawText(bx, by, bw, bh, fz) {
    const pad = 0.026 * S.imgW * scale();
    const tw = bw - 2*pad, th = bh - 2*pad, lineH = fz * 1.25;
    const lines = wrapLines(S.text, tw), shown = lines.slice(0, Math.floor(th / lineH));
    let y = by + pad + Math.max(0, (th - shown.length * lineH) / 2);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center';
    for (const ln of shown) { ctx.fillText(ln, bx + bw/2, y); y += lineH; }
  }

  function getBD() {
    const sc = scale();
    return { bx:S.bxN*S.imgW*sc, by:S.byN*S.imgH*sc, bw:S.bwN*S.imgW*sc, bh:S.bhN*S.imgH*sc,
             tx:S.txN*S.imgW*sc, ty:S.tyN*S.imgH*sc };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  function drawBalloon() {
    const { bx, by, bw, bh, tx, ty } = getBD();
    const sc = scale(), border = Math.max(1.5, 0.006*S.imgW*sc), r = 0.035*S.imgW*sc;
    const fz = 0.038*S.imgW*sc*Math.min(1.2, bw/(0.56*S.imgW*sc)), t = S.template;
    const isEmpty = !S.text || !S.text.trim();
    ctx.font = `700 ${fz}px Sarabun,Tahoma,sans-serif`;
    ctx.textBaseline = 'top'; ctx.lineJoin = 'round';

    if (t === 'thought') {
      const [cx2,cy2,rx2,ry2]=[bx+bw/2,by+bh/2,bw/2,bh/2], [bumps,bR]=[9,Math.min(rx2,ry2)*0.28];
      ctx.fillStyle='#fff'; ctx.strokeStyle='#111'; ctx.lineWidth=border;
      for(let i=0;i<bumps;i++){const a=(i/bumps)*Math.PI*2-Math.PI/2;
        ctx.beginPath();ctx.arc(cx2+rx2*0.78*Math.cos(a),cy2+ry2*0.78*Math.sin(a),bR,0,Math.PI*2);ctx.fill();ctx.stroke();}
      ctx.beginPath();ctx.ellipse(cx2,cy2,rx2*0.72,ry2*0.72,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      for(const s of[0.7,0.5,0.3]){ctx.beginPath();ctx.arc(cx2+(tx-cx2)*(1-s),cy2+(ty-cy2)*(1-s),bR*s*0.7,0,Math.PI*2);ctx.fill();ctx.stroke();}
      if (!isEmpty) drawText(bx+bw*0.14,by+bh*0.14,bw*0.72,bh*0.72,fz);

    } else if (t === 'shout') {
      const [cx2,cy2]=[bx+bw/2,by+bh/2],inner=Math.min(bw,bh)*0.38,outer2=Math.min(bw,bh)*0.55,pts=16;
      ctx.beginPath();
      for(let i=0;i<pts*2;i++){const a=(i/(pts*2))*Math.PI*2-Math.PI/2,rx3=(i%2===0?outer2:inner)*(bw/Math.min(bw,bh)),ry3=(i%2===0?outer2:inner)*(bh/Math.min(bw,bh));
        i===0?ctx.moveTo(cx2+rx3*Math.cos(a),cy2+ry3*Math.sin(a)):ctx.lineTo(cx2+rx3*Math.cos(a),cy2+ry3*Math.sin(a));}
      ctx.closePath();ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=border;ctx.strokeStyle='#111';ctx.stroke();
      ctx.beginPath();ctx.moveTo(bx+0.15*bw,by+1);ctx.lineTo(bx+0.35*bw,by+1);ctx.lineTo(tx,ty);
      ctx.closePath();ctx.fillStyle='#fff';ctx.fill();ctx.stroke();
      ctx.font=`900 ${fz*1.05}px Sarabun,Tahoma,sans-serif`;
      if (!isEmpty) drawText(bx+bw*0.1,by+bh*0.1,bw*0.8,bh*0.8,fz);

    } else if (t === 'whisper') {
      ctx.save();ctx.setLineDash([border*2,border*2]);
      ctx.beginPath();ctx.moveTo(bx+0.12*bw,by+1);ctx.lineTo(bx+0.18*bw,by+1);ctx.lineTo(tx,ty);
      ctx.closePath();ctx.fillStyle='rgba(255,255,255,0.92)';ctx.fill();ctx.lineWidth=border;ctx.strokeStyle='#666';ctx.stroke();
      roundRect(bx,by,bw,bh,r*1.5);ctx.fillStyle='rgba(255,255,255,0.92)';ctx.fill();ctx.stroke();ctx.restore();
      ctx.font=`400 ${fz*0.9}px Sarabun,Tahoma,sans-serif`;
      if (!isEmpty) drawText(bx,by,bw,bh,fz*0.9);

    } else {
      ctx.beginPath();ctx.moveTo(bx+0.10*bw,by+1);ctx.lineTo(bx+0.30*bw,by+1);ctx.lineTo(tx,ty);
      ctx.closePath();ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=border;ctx.strokeStyle='#111';ctx.stroke();
      roundRect(bx,by,bw,bh,r);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=border;ctx.strokeStyle='#111';ctx.stroke();
      if (!isEmpty) drawText(bx,by,bw,bh,fz);
    }

    if (isEmpty) {
      ctx.save();
      ctx.font = `400 ${fz*0.75}px Sarabun,Tahoma,sans-serif`;
      ctx.fillStyle = 'rgba(100,100,100,0.6)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('💬 ดับเบิ้ลคลิกเพื่อพิมพ์', bx+bw/2, by+bh/2);
      ctx.restore();
    }
  }

  function getHandles(bx, by, bw, bh) {
    return [{id:'nw',x:bx,y:by},{id:'n',x:bx+bw/2,y:by},{id:'ne',x:bx+bw,y:by},
            {id:'e',x:bx+bw,y:by+bh/2},{id:'se',x:bx+bw,y:by+bh},{id:'s',x:bx+bw/2,y:by+bh},
            {id:'sw',x:bx,y:by+bh},{id:'w',x:bx,y:by+bh/2}];
  }

  function drawHandles() {
    const { bx, by, bw, bh, tx, ty } = getBD();
    ctx.strokeStyle='#f59e0b'; ctx.fillStyle='#fff'; ctx.lineWidth=2;
    for(const h of getHandles(bx,by,bw,bh)){ctx.fillRect(h.x-HANDLE_R,h.y-HANDLE_R,HANDLE_R*2,HANDLE_R*2);ctx.strokeRect(h.x-HANDLE_R,h.y-HANDLE_R,HANDLE_R*2,HANDLE_R*2);}
    ctx.beginPath();ctx.arc(tx,ty,TAIL_R,0,Math.PI*2);ctx.fillStyle='#f59e0b';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    if (typeof drawProductHandles==='function') drawProductHandles(ctx, S, scale());
  }

  function hitTest(mx, my) {
    const ph = typeof productHitTest==='function' ? productHitTest(mx,my) : null;
    if (ph) return ph;
    const { bx, by, bw, bh, tx, ty } = getBD();
    if (Math.hypot(mx-tx, my-ty) <= TAIL_R+4) return 'tail';
    for(const h of getHandles(bx,by,bw,bh)) if(Math.abs(mx-h.x)<=HANDLE_R+3 && Math.abs(my-h.y)<=HANDLE_R+3) return h.id;
    if (mx>=bx && mx<=bx+bw && my>=by && my<=by+bh) return 'body';
    return null;
  }

  function drawFrame() {
    if (!S || !img) return;
    canvas.width = S.dispW; canvas.height = S.dispH;
    ctx.drawImage(img, 0, 0, S.dispW, S.dispH);
    if (typeof drawProductLayer==='function') drawProductLayer(ctx, S, scale());
    drawBalloon();
    drawHandles();
  }

  function getPos(e) {
    const r = canvas.getBoundingClientRect(), src = e.touches?e.touches[0]:e;
    return { x: src.clientX-r.left, y: src.clientY-r.top };
  }

  function applyResize(hid, dx, dy) {
    const sc = scale(), dxN=dx/(S.imgW*sc), dyN=dy/(S.imgH*sc);
    const minW=0.1, minH=0.08;
    if(hid.includes('e')) S.bwN=Math.max(minW,S.bwN+dxN);
    if(hid.includes('s')) S.bhN=Math.max(minH,S.bhN+dyN);
    if(hid.includes('w')){const nb=Math.max(minW,S.bwN-dxN);S.bxN+=S.bwN-nb;S.bwN=nb;}
    if(hid.includes('n')){const nb=Math.max(minH,S.bhN-dyN);S.byN+=S.bhN-nb;S.bhN=nb;}
  }

  function onDown(e) {
    if (!S) return; e.preventDefault();
    const { x, y } = getPos(e);
    const hit = hitTest(x, y); if (!hit) return;
    const pp = typeof getProductParams==='function' ? {...(getProductParams()||{})} : null;
    drag = { hit, startX:x, startY:y, origBxN:S.bxN, origByN:S.byN, origBwN:S.bwN, origBhN:S.bhN, origTxN:S.txN, origTyN:S.tyN, origP:pp };
  }

  function onMove(e) {
    if (!S || !drag) return; e.preventDefault();
    const { x, y } = getPos(e), dx=x-drag.startX, dy=y-drag.startY, sc=scale();
    S.bxN=drag.origBxN; S.byN=drag.origByN; S.bwN=drag.origBwN; S.bhN=drag.origBhN;
    S.txN=drag.origTxN; S.tyN=drag.origTyN;
    if (drag.origP) window._productRestoreOrig?.(drag.origP);
    if (drag.hit==='body') { S.bxN=drag.origBxN+dx/(S.imgW*sc); S.byN=drag.origByN+dy/(S.imgH*sc); }
    else if (drag.hit==='tail') { S.txN=Math.max(0,Math.min(1,drag.origTxN+dx/(S.imgW*sc))); S.tyN=Math.max(0,Math.min(1,drag.origTyN+dy/(S.imgH*sc))); }
    else if (drag.hit==='p-body') { window._productMoveBody?.(dx/(S.imgW*sc), dy/(S.imgH*sc)); }
    else if (drag.hit.startsWith('p-')) { window._productResize?.(drag.hit, dx/(S.imgW*sc), dy/(S.imgH*sc)); }
    else { applyResize(drag.hit, dx, dy); }
    drawFrame();
  }

  function onUp() { drag = null; }

  function onDblClick(e) {
    if (!S) return;
    const { x, y } = getPos(e); if (hitTest(x,y) !== 'body') return;
    const { bx, by, bw, bh } = getBD(), rect = canvas.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.value = S.text;
    Object.assign(ta.style, { position:'fixed', left:(rect.left+bx)+'px', top:(rect.top+by)+'px',
      width:bw+'px', height:bh+'px', fontSize:'14px', fontFamily:'Sarabun,sans-serif',
      background:'rgba(255,255,255,0.95)', border:'2px solid #f59e0b', borderRadius:'8px',
      padding:'8px', resize:'none', zIndex:999, color:'#111', outline:'none' });
    document.body.appendChild(ta); ta.focus();
    const commit = () => { S.text=ta.value; const sp=document.getElementById('f-speech'); if(sp) sp.value=S.text; ta.remove(); drawFrame(); };
    ta.addEventListener('keydown', ev => { if(ev.key==='Escape') ta.remove(); });
    ta.addEventListener('blur', commit);
  }

  function initBalloonEditor(container, imgUrl, speech, template, saved={}) {
    drag = null; container.innerHTML = '';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;max-width:100%;cursor:move;border-radius:12px;border:1px solid rgba(255,255,255,.08)';
    container.appendChild(canvas); ctx = canvas.getContext('2d');
    img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sc = Math.min((container.offsetWidth||600)/img.width, window.innerHeight*0.52/img.height, 1);
      S = { imgW:img.width, imgH:img.height, dispW:Math.round(img.width*sc), dispH:Math.round(img.height*sc),
            bxN:saved.bxN??0.05, byN:saved.byN??0.04, bwN:saved.bwN??0.60, bhN:saved.bhN??0.26,
            txN:saved.txN??0.50, tyN:saved.tyN??0.46, template:template||'speech', text:speech||'' };
      drawFrame();
    };
    img.onerror = () => {
      const fallback = imgUrl.replace(/final\.jpg(\?.*)?$/, 'image.png');
      if (!img.src.includes('image.png')) img.src = fallback;
    };
    img.src = imgUrl;
    canvas.addEventListener('mousedown',onDown); canvas.addEventListener('mousemove',onMove);
    canvas.addEventListener('mouseup',onUp); canvas.addEventListener('mouseleave',onUp);
    canvas.addEventListener('touchstart',onDown,{passive:false}); canvas.addEventListener('touchmove',onMove,{passive:false});
    canvas.addEventListener('touchend',onUp); canvas.addEventListener('dblclick',onDblClick);
  }

  window.initBalloonEditor  = initBalloonEditor;
  window.setBalloonTemplate = t => { if(S){S.template=t;drawFrame();} };
  window.setBalloonText     = t => { if(S){S.text=t;drawFrame();} };
  window.getBalloonParams   = () => { const pp=typeof getProductParams==='function'?getProductParams():null; return S?{bxN:S.bxN,byN:S.byN,bwN:S.bwN,bhN:S.bhN,txN:S.txN,tyN:S.tyN,template:S.template,text:S.text,...(pp||{})}:null; };
  window._beState=()=>S; window._beScale=scale; window._beRedraw=()=>drawFrame();
  window.exportCanvas = () => canvas ? canvas.toDataURL('image/jpeg', 0.95) : null;
})();
