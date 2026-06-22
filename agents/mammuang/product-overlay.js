// product-overlay.js — product image layer for balloon-editor canvas
// Hooks into balloon-editor.js via window._be* + window.drawProduct*/productHitTest/etc.
(function () {
  const HR = 8;
  let P = null; // {pxN, pyN, pwN, phN, imgEl}

  function getPD(sc, W, H) {
    return { px: P.pxN*W*sc, py: P.pyN*H*sc, pw: P.pwN*W*sc, ph: P.phN*H*sc };
  }

  window.drawProductLayer = function (ctx, S, sc) {
    if (!P?.imgEl) return;
    const { px, py, pw, ph } = getPD(sc, S.imgW, S.imgH);
    const border = Math.max(3, pw * 0.04);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = pw*0.07;
    ctx.shadowOffsetX = pw*0.025; ctx.shadowOffsetY = pw*0.025;
    ctx.fillStyle = '#fff';
    ctx.fillRect(px-border, py-border, pw+border*2, ph+border*2);
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.fillRect(px-border, py-border, pw+border*2, ph+border*2);
    ctx.drawImage(P.imgEl, px, py, pw, ph);
  };

  window.drawProductHandles = function (ctx, S, sc) {
    if (!P?.imgEl) return;
    const { px, py, pw, ph } = getPD(sc, S.imgW, S.imgH);
    ctx.strokeStyle = '#3b82f6'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
    for (const c of [{x:px,y:py},{x:px+pw,y:py},{x:px+pw,y:py+ph},{x:px,y:py+ph}]) {
      ctx.fillRect(c.x-HR, c.y-HR, HR*2, HR*2);
      ctx.strokeRect(c.x-HR, c.y-HR, HR*2, HR*2);
    }
  };

  window.productHitTest = function (mx, my) {
    if (!P?.imgEl) return null;
    const S = window._beState?.(); const sc = window._beScale?.() || 1;
    if (!S) return null;
    const { px, py, pw, ph } = getPD(sc, S.imgW, S.imgH);
    const corners = [{id:'p-nw',x:px,y:py},{id:'p-ne',x:px+pw,y:py},{id:'p-se',x:px+pw,y:py+ph},{id:'p-sw',x:px,y:py+ph}];
    for (const c of corners) if (Math.hypot(mx-c.x, my-c.y) <= HR+3) return c.id;
    if (mx>=px && mx<=px+pw && my>=py && my<=py+ph) return 'p-body';
    return null;
  };

  window._productMoveBody = (dxN, dyN) => {
    if (P) { P.pxN += dxN; P.pyN += dyN; }
  };

  window._productResize = (hid, dxN, dyN) => {
    if (!P) return;
    const minW = 0.05, minH = 0.04;
    if (hid==='p-ne'||hid==='p-se') P.pwN = Math.max(minW, P.pwN + dxN);
    if (hid==='p-se'||hid==='p-sw') P.phN = Math.max(minH, P.phN + dyN);
    if (hid==='p-nw'||hid==='p-sw') { const nb=Math.max(minW,P.pwN-dxN); P.pxN+=P.pwN-nb; P.pwN=nb; }
    if (hid==='p-nw'||hid==='p-ne') { const nb=Math.max(minH,P.phN-dyN); P.pyN+=P.phN-nb; P.phN=nb; }
  };

  window._productRestoreOrig = (orig) => {
    if (P && orig) { P.pxN=orig.pxN; P.pyN=orig.pyN; P.pwN=orig.pwN; P.phN=orig.phN; }
  };

  window.getProductParams = () => P?.imgEl ? { pxN:P.pxN, pyN:P.pyN, pwN:P.pwN, phN:P.phN } : null;

  window.setProductImage = function (url) {
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => {
      const ar = i.height / i.width;
      P = { imgEl: i, pxN: 0.03, pyN: 0.65, pwN: 0.30, phN: 0.30 * ar };
      window._beRedraw?.();
    };
    i.src = url;
  };

  window.clearProductImage = () => { P = null; window._beRedraw?.(); };
})();
