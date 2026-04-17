/**
 * Anime Tracker — Weekly Share Card (v5 — Ultra HD + Downsample)
 * Canvas 2400×1260 (2x supersampling) → final 1200×630.
 * Εξασφαλίζει μέγιστη ποιότητα χωρίς απώλειες.
 */
(function () {
    'use strict';

    // Ονομαστικές διαστάσεις εξόδου (social card)
    const OUT_W = 1200;
    const OUT_H = 630;

    // Εσωτερική ανάλυση 2x (για supersampling)
    const RENDER_W = OUT_W * 2;  // 2400
    const RENDER_H = OUT_H * 2;  // 1260

    // Scale factor για conversion συντεταγμένων
    const SCALE = 2;

    /* ── helpers (ίδια, αλλά με scaling) ── */
    function fmtH(s) {
        const h = s / 3600;
        if (h === 0) return '0h';
        if (h >= 100) return Math.round(h) + 'h';
        return h.toFixed(1) + 'h';
    }

    function loadImg(url) {
        return new Promise(resolve => {
            if (!url) return resolve(null);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            setTimeout(() => resolve(null), 4000);
            img.src = url;
        });
    }

    function roundRect(ctx, x, y, w, h, r) {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad);
        ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad);
        ctx.arcTo(x, y, x + w, y, rad);
        ctx.closePath();
    }

    function clip(ctx, text, font, maxW) {
        ctx.font = font;
        if (ctx.measureText(text).width <= maxW) return text;
        const ell = '…';
        let lo = 0, hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            ctx.font = font;
            if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
            else hi = mid - 1;
        }
        return text.slice(0, lo) + ell;
    }

    function drawNoise(ctx, w, h, alpha = 0.02) {
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tc = tmp.getContext('2d');
        const id = tc.createImageData(w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
            const v = Math.random() * 255;
            d[i] = d[i + 1] = d[i + 2] = v;
            d[i + 3] = alpha * 255;
        }
        tc.putImageData(id, 0, 0);
        ctx.drawImage(tmp, 0, 0);
    }

    function drawSparkles(ctx, x, y, w, h, count, color) {
        const seed = (x * 7 + y * 13) | 0;
        function pseudoRand(i) {
            const s = Math.sin(seed + i * 127.1) * 43758.5453;
            return s - Math.floor(s);
        }
        for (let i = 0; i < count; i++) {
            const sx = x + pseudoRand(i * 3) * w;
            const sy = y + pseudoRand(i * 3 + 1) * h;
            const size = 1 + pseudoRand(i * 3 + 2) * 3;
            const alpha = 0.3 + pseudoRand(i * 3 + 7) * 0.7;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;

            ctx.beginPath();
            ctx.moveTo(sx, sy - size);
            ctx.lineTo(sx + size * 0.3, sy - size * 0.3);
            ctx.lineTo(sx + size, sy);
            ctx.lineTo(sx + size * 0.3, sy + size * 0.3);
            ctx.lineTo(sx, sy + size);
            ctx.lineTo(sx - size * 0.3, sy + size * 0.3);
            ctx.lineTo(sx - size, sy);
            ctx.lineTo(sx - size * 0.3, sy - size * 0.3);
            ctx.closePath();
            ctx.fill();

            const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 2.5);
            sg.addColorStop(0, color);
            sg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = sg;
            ctx.fillRect(sx - size * 3, sy - size * 3, size * 6, size * 6);
            ctx.restore();
        }
    }

    function drawGlassPanel(ctx, x, y, w, h, r, opts = {}) {
        const { bg = 'rgba(255,255,255,0.04)', border = 'rgba(255,255,255,0.08)', shadow = true } = opts;
        if (shadow) {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 24;
            ctx.shadowOffsetY = 8;
            ctx.fillStyle = bg;
            roundRect(ctx, x, y, w, h, r);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.fillStyle = bg;
            roundRect(ctx, x, y, w, h, r);
            ctx.fill();
        }
        ctx.save();
        roundRect(ctx, x, y, w, h, r);
        ctx.clip();
        const hl = ctx.createLinearGradient(x, y, x, y + 3);
        hl.addColorStop(0, 'rgba(255,255,255,0.15)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(x, y, w, 3);
        ctx.restore();

        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, w, h, r);
        ctx.stroke();
    }

    /* ── κύρια render με supersampling ── */
    async function render(animeData, index) {
        const { StatsEngine } = window.AnimeTracker;
        try { if (document.fonts?.ready) await document.fonts.ready; } catch { }

        // Δημιουργούμε canvas σε διπλή ανάλυση
        const canvasHi = document.createElement('canvas');
        canvasHi.width = RENDER_W;
        canvasHi.height = RENDER_H;
        const ctx = canvasHi.getContext('2d');

        // Ενεργοποιούμε υψηλή ποιότητα smoothing για εικόνες
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // ---------- Όλες οι συντεταγμένες πολλαπλασιάζονται με SCALE ----------
        const LX = 56 * SCALE;
        const RX = 560 * SCALE;
        const colW = (RENDER_W - RX - 48 * SCALE);
        const Hh = RENDER_H;

        /* ── 1. Background ── */
        const bgGrad = ctx.createLinearGradient(0, 0, RENDER_W, Hh);
        bgGrad.addColorStop(0, '#0a0710');
        bgGrad.addColorStop(0.3, '#0f0a14');
        bgGrad.addColorStop(0.6, '#120c10');
        bgGrad.addColorStop(1, '#0a080c');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, RENDER_W, Hh);

        const glow1 = ctx.createRadialGradient(RENDER_W - 200, -120, 40, RENDER_W - 200, -120, 1040);
        glow1.addColorStop(0, 'rgba(255,90,40,0.28)');
        glow1.addColorStop(0.3, 'rgba(255,60,30,0.12)');
        glow1.addColorStop(1, 'rgba(255,60,30,0)');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, RENDER_W, Hh);

        const glow2 = ctx.createRadialGradient(160, Hh + 120, 40, 160, Hh + 120, 900);
        glow2.addColorStop(0, 'rgba(120,70,220,0.20)');
        glow2.addColorStop(0.4, 'rgba(100,60,180,0.08)');
        glow2.addColorStop(1, 'rgba(100,60,180,0)');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, RENDER_W, Hh);

        const glow3 = ctx.createRadialGradient(RENDER_W * 0.35, Hh * 0.4, 20, RENDER_W * 0.35, Hh * 0.4, 500);
        glow3.addColorStop(0, 'rgba(60,200,220,0.05)');
        glow3.addColorStop(1, 'rgba(60,200,220,0)');
        ctx.fillStyle = glow3;
        ctx.fillRect(0, 0, RENDER_W, Hh);

        drawNoise(ctx, RENDER_W, Hh, 0.02);

        /* ── 2. Left column ── */
        const chipW = 192 * SCALE, chipH = 32 * SCALE;
        const chipGrad = ctx.createLinearGradient(LX, 42 * SCALE, LX + chipW, 42 * SCALE);
        chipGrad.addColorStop(0, 'rgba(255,100,50,0.22)');
        chipGrad.addColorStop(1, 'rgba(255,100,50,0.06)');
        ctx.fillStyle = chipGrad;
        roundRect(ctx, LX, 42 * SCALE, chipW, chipH, chipH / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,120,60,0.20)';
        ctx.lineWidth = 1;
        roundRect(ctx, LX, 42 * SCALE, chipW, chipH, chipH / 2);
        ctx.stroke();

        ctx.fillStyle = '#ff6a3d';
        ctx.beginPath();
        ctx.arc(LX + 14 * SCALE, 42 * SCALE + chipH / 2, 3.5 * SCALE, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,106,61,0.35)';
        ctx.beginPath();
        ctx.arc(LX + 14 * SCALE, 42 * SCALE + chipH / 2, 7 * SCALE, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffb08a';
        ctx.font = `600 ${12.5 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('AN1ME.TO  TRACKER', LX + 26 * SCALE, 42 * SCALE + 21 * SCALE);

        const weekEnd = new Date();
        const weekStart = new Date(); weekStart.setDate(weekEnd.getDate() - 6);
        const range = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = `400 ${13 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.fillText(range, LX, 112 * SCALE);

        const headGrad = ctx.createLinearGradient(LX, 130 * SCALE, LX + 420 * SCALE, 175 * SCALE);
        headGrad.addColorStop(0, '#ffffff');
        headGrad.addColorStop(0.6, 'rgba(255,190,150,0.95)');
        headGrad.addColorStop(1, 'rgba(210,170,255,0.85)');
        ctx.fillStyle = headGrad;
        ctx.font = `800 ${54 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.fillText('Weekly Recap', LX, 168 * SCALE);

        const lineGrad = ctx.createLinearGradient(LX, 0, LX + 460 * SCALE, 0);
        lineGrad.addColorStop(0, 'rgba(255,120,60,0.35)');
        lineGrad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
        lineGrad.addColorStop(1, 'rgba(130,80,220,0.25)');
        ctx.fillStyle = lineGrad;
        ctx.fillRect(LX, 184 * SCALE, 460 * SCALE, 1.5 * SCALE);

        /* ── 3. Stats row ── */
        const weekly = StatsEngine.windowStats(index, 7);
        const streak = StatsEngine.computeStreak(index);
        const stats = [
            { num: String(weekly.episodes), lbl: 'Episodes', accent: '#ff8a5c', glow: 'rgba(255,138,92,0.18)', sparkleColor: 'rgba(255,180,140,0.9)' },
            { num: fmtH(weekly.seconds), lbl: 'Watch Time', accent: '#c084fc', glow: 'rgba(192,132,252,0.14)', sparkleColor: 'rgba(220,180,255,0.9)' },
            { num: `${streak.currentStreak}`, lbl: 'Day Streak', accent: '#fbbf24', glow: 'rgba(251,191,36,0.14)', sparkleColor: 'rgba(255,230,140,0.9)', icon: '🔥' }
        ];
        const statW = 150 * SCALE;
        const statGap = 10 * SCALE;
        stats.forEach((s, i) => {
            const sx = LX + i * (statW + statGap);
            const sy = 206 * SCALE;
            const sh = 86 * SCALE;

            drawGlassPanel(ctx, sx, sy, statW, sh, 12 * SCALE, {
                bg: s.glow,
                border: `${s.accent}33`
            });

            ctx.save();
            roundRect(ctx, sx, sy, statW, sh, 12 * SCALE);
            ctx.clip();
            drawSparkles(ctx, sx, sy, statW, sh, 6 + i * 2, s.sparkleColor);
            ctx.restore();

            ctx.fillStyle = s.accent;
            ctx.font = `700 ${34 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'left';
            const numText = s.icon ? s.num + ' ' + s.icon : s.num;
            ctx.fillText(numText, sx + 16 * SCALE, sy + 48 * SCALE);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `500 ${11.5 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.fillText(s.lbl, sx + 16 * SCALE, sy + 70 * SCALE);
        });

        /* ── 4. Heatmap ── */
        const hmY = 320 * SCALE;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `600 ${10 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.letterSpacing = '1.5px';
        ctx.fillText('ACTIVITY', LX, hmY - 6 * SCALE);
        ctx.letterSpacing = '0px';

        const hmStartY = hmY + 10 * SCALE;
        const cellW = 54 * SCALE, cellH = 46 * SCALE, cellGap = 8 * SCALE;
        const maxEp = Math.max(1, ...weekly.days.map(d => d.episodes));
        const dayShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

        weekly.days.forEach((d, i) => {
            const cx = LX + i * (cellW + cellGap);
            const intensity = d.episodes === 0 ? 0 : 0.2 + (d.episodes / maxEp) * 0.8;
            if (d.episodes > 0) {
                const cellGrad = ctx.createLinearGradient(cx, hmStartY, cx, hmStartY + cellH);
                cellGrad.addColorStop(0, `rgba(255, 120, 50, ${intensity * 0.9})`);
                cellGrad.addColorStop(1, `rgba(200, 80, 30, ${intensity * 0.7})`);
                ctx.fillStyle = cellGrad;
                roundRect(ctx, cx, hmStartY, cellW, cellH, 10 * SCALE);
                ctx.fill();
                ctx.save();
                roundRect(ctx, cx, hmStartY, cellW, cellH, 10 * SCALE);
                ctx.clip();
                const ig = ctx.createRadialGradient(cx + cellW / 2, hmStartY + cellH / 2, 2 * SCALE, cx + cellW / 2, hmStartY + cellH / 2, cellW / 2);
                ig.addColorStop(0, `rgba(255,220,180,${intensity * 0.25})`);
                ig.addColorStop(1, 'rgba(255,220,180,0)');
                ctx.fillStyle = ig;
                ctx.fillRect(cx, hmStartY, cellW, cellH);
                ctx.restore();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                roundRect(ctx, cx, hmStartY, cellW, cellH, 10 * SCALE);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.05)';
                ctx.lineWidth = 1;
                roundRect(ctx, cx, hmStartY, cellW, cellH, 10 * SCALE);
                ctx.stroke();
            }
            if (d.episodes > 0) {
                ctx.fillStyle = '#fff';
                ctx.font = `700 ${19 * SCALE}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(String(d.episodes), cx + cellW / 2, hmStartY + cellH / 2 + 7 * SCALE);
            }
            const dateObj = new Date(d.dayKey + 'T00:00:00');
            ctx.fillStyle = d.episodes > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
            ctx.font = `500 ${10.5 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(dayShort[dateObj.getDay()], cx + cellW / 2, hmStartY + cellH + 16 * SCALE);
        });
        ctx.textAlign = 'left';

        /* ── 5. Footer ── */
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = `400 ${11 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.fillText('Generated by Anime Tracker  ·  an1me.to', LX, Hh - 26 * SCALE);
        const footGrad = ctx.createLinearGradient(LX, Hh - 14 * SCALE, LX + 120 * SCALE, Hh - 14 * SCALE);
        footGrad.addColorStop(0, 'rgba(255,100,50,0.45)');
        footGrad.addColorStop(1, 'rgba(130,80,220,0.35)');
        ctx.fillStyle = footGrad;
        roundRect(ctx, LX, Hh - 16 * SCALE, 120 * SCALE, 2.5 * SCALE, 2 * SCALE);
        ctx.fill();

        /* ── 6. Right column ── */
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = `600 ${10.5 * SCALE}px Inter, system-ui, sans-serif`;
        ctx.letterSpacing = '2px';
        ctx.fillText('TOP THIS WEEK', RX, 60 * SCALE);
        ctx.letterSpacing = '0px';

        const topLineGrad = ctx.createLinearGradient(RX, 0, RX + 130 * SCALE, 0);
        topLineGrad.addColorStop(0, 'rgba(255,100,50,0.5)');
        topLineGrad.addColorStop(1, 'rgba(255,100,50,0)');
        ctx.fillStyle = topLineGrad;
        ctx.fillRect(RX, 66 * SCALE, 130 * SCALE, 1.5 * SCALE);

        const top = StatsEngine.topAnimeInWindow(animeData, 7, 4);
        if (top.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = `400 ${18 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.fillText('No episodes watched this week', RX, 130 * SCALE);
        } else {
            const imgs = await Promise.all(top.map(a => loadImg(a.coverImage)));
            const hero = top[0];
            const heroImg = imgs[0];
            const heroY = 82 * SCALE;
            const heroH = 290 * SCALE;
            const heroW = colW;

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 30 * SCALE;
            ctx.shadowOffsetY = 10 * SCALE;
            ctx.fillStyle = 'rgba(0,0,0,0.01)';
            roundRect(ctx, RX, heroY, heroW, heroH, 16 * SCALE);
            ctx.fill();
            ctx.restore();

            const heroBg = ctx.createLinearGradient(RX, heroY, RX + heroW, heroY + heroH);
            heroBg.addColorStop(0, 'rgba(255,80,40,0.12)');
            heroBg.addColorStop(1, 'rgba(130,60,200,0.08)');
            ctx.fillStyle = heroBg;
            roundRect(ctx, RX, heroY, heroW, heroH, 16 * SCALE);
            ctx.fill();

            if (heroImg) {
                ctx.save();
                roundRect(ctx, RX, heroY, heroW, heroH, 16 * SCALE);
                ctx.clip();
                const ir = heroImg.width / heroImg.height;
                const cr = heroW / heroH;
                let sx = 0, sy = 0, sw = heroImg.width, sh = heroImg.height;
                if (ir > cr) { sw = heroImg.height * cr; sx = (heroImg.width - sw) / 2; }
                else { sh = heroImg.width / cr; sy = (heroImg.height - sh) / 2; }
                ctx.drawImage(heroImg, sx, sy, sw, sh, RX, heroY, heroW, heroH);
                const overlay = ctx.createLinearGradient(RX, heroY, RX, heroY + heroH);
                overlay.addColorStop(0, 'rgba(10,7,12,0)');
                overlay.addColorStop(0.35, 'rgba(10,7,12,0)');
                overlay.addColorStop(0.6, 'rgba(10,7,12,0.35)');
                overlay.addColorStop(1, 'rgba(10,7,12,0.90)');
                ctx.fillStyle = overlay;
                ctx.fillRect(RX, heroY, heroW, heroH);
                ctx.restore();
            }

            const badgeX = RX + 14 * SCALE, badgeY = heroY + 14 * SCALE;
            const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + 30 * SCALE, badgeY + 30 * SCALE);
            badgeGrad.addColorStop(0, '#ff6a3d');
            badgeGrad.addColorStop(1, '#ff3d6a');
            ctx.fillStyle = badgeGrad;
            roundRect(ctx, badgeX, badgeY, 30 * SCALE, 30 * SCALE, 8 * SCALE);
            ctx.fill();
            ctx.save();
            ctx.shadowColor = 'rgba(255,70,50,0.5)';
            ctx.shadowBlur = 10 * SCALE;
            ctx.fillStyle = 'rgba(0,0,0,0)';
            roundRect(ctx, badgeX, badgeY, 30 * SCALE, 30 * SCALE, 8 * SCALE);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#fff';
            ctx.font = `800 ${15 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('#1', badgeX + 15 * SCALE, badgeY + 21 * SCALE);
            ctx.textAlign = 'left';

            ctx.fillStyle = '#ffffff';
            ctx.font = `700 ${24 * SCALE}px Inter, system-ui, sans-serif`;
            const heroTitle = clip(ctx, hero.title || hero.slug, ctx.font, heroW - 30 * SCALE);
            ctx.fillText(heroTitle, RX + 16 * SCALE, heroY + heroH - 38 * SCALE);
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = `500 ${13 * SCALE}px Inter, system-ui, sans-serif`;
            ctx.fillText(`${hero.episodes} episodes  ·  ${fmtH(hero.seconds)}`, RX + 16 * SCALE, heroY + heroH - 16 * SCALE);

            const cardY = heroY + heroH + 14 * SCALE;
            const cardH = 72 * SCALE;
            const thumbW = 48 * SCALE;
            const remaining = top.slice(1, 4);
            remaining.forEach((anime, i) => {
                const img = imgs[i + 1];
                const cy = cardY + i * (cardH + 10 * SCALE);
                const cw = colW;
                drawGlassPanel(ctx, RX, cy, cw, cardH, 12 * SCALE, {
                    bg: 'rgba(255,255,255,0.035)',
                    border: 'rgba(255,255,255,0.07)',
                    shadow: false
                });
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.font = `800 ${36 * SCALE}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(`${i + 2}`, RX + cw - 14 * SCALE, cy + cardH / 2 + 13 * SCALE);
                ctx.textAlign = 'left';
                if (img) {
                    ctx.save();
                    roundRect(ctx, RX + 12 * SCALE, cy + 12 * SCALE, thumbW, cardH - 24 * SCALE, 8 * SCALE);
                    ctx.clip();
                    const ir = img.width / img.height;
                    const cr = thumbW / (cardH - 24 * SCALE);
                    let sx = 0, sy = 0, sw = img.width, sh = img.height;
                    if (ir > cr) { sw = img.height * cr; sx = (img.width - sw) / 2; }
                    else { sh = img.width / cr; sy = (img.height - sh) / 2; }
                    ctx.drawImage(img, sx, sy, sw, sh, RX + 12 * SCALE, cy + 12 * SCALE, thumbW, cardH - 24 * SCALE);
                    ctx.restore();
                } else {
                    const thumbGrad = ctx.createLinearGradient(RX + 12 * SCALE, cy + 12 * SCALE, RX + 12 * SCALE + thumbW, cy + cardH - 12 * SCALE);
                    thumbGrad.addColorStop(0, 'rgba(255,100,50,0.3)');
                    thumbGrad.addColorStop(1, 'rgba(130,60,200,0.2)');
                    ctx.fillStyle = thumbGrad;
                    roundRect(ctx, RX + 12 * SCALE, cy + 12 * SCALE, thumbW, cardH - 24 * SCALE, 8 * SCALE);
                    ctx.fill();
                }
                const tx = RX + 12 * SCALE + thumbW + 14 * SCALE;
                ctx.fillStyle = '#fff';
                ctx.font = `600 ${15 * SCALE}px Inter, system-ui, sans-serif`;
                const ttitle = clip(ctx, anime.title || anime.slug, ctx.font, cw - thumbW - 80 * SCALE);
                ctx.fillText(ttitle, tx, cy + 30 * SCALE);
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = `400 ${12 * SCALE}px Inter, system-ui, sans-serif`;
                ctx.fillText(`${anime.episodes} ep  ·  ${fmtH(anime.seconds)}`, tx, cy + 50 * SCALE);
            });
        }

        const divGrad = ctx.createLinearGradient(0, 56 * SCALE, 0, Hh - 112 * SCALE);
        divGrad.addColorStop(0, 'rgba(255,255,255,0)');
        divGrad.addColorStop(0.2, 'rgba(255,255,255,0.06)');
        divGrad.addColorStop(0.8, 'rgba(255,255,255,0.06)');
        divGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = divGrad;
        ctx.fillRect(RX - 24 * SCALE, 56 * SCALE, 1 * SCALE, Hh - 112 * SCALE);

        // ---------- Τέλος high-res rendering ----------
        // Τώρα κλιμακώνουμε το αποτέλεσμα σε 1200×630 με υψηλή ποιότητα
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = OUT_W;
        finalCanvas.height = OUT_H;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.imageSmoothingEnabled = true;
        finalCtx.imageSmoothingQuality = 'high';
        finalCtx.drawImage(canvasHi, 0, 0, RENDER_W, RENDER_H, 0, 0, OUT_W, OUT_H);

        return finalCanvas;
    }

    async function generateAndOpen(animeData, index) {
        try {
            const canvas = await render(animeData, index);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            if (!blob) { alert('Could not generate share card.'); return; }
            const url = URL.createObjectURL(blob);
            try {
                if (navigator.clipboard?.write && window.ClipboardItem) {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                }
            } catch { }
            try {
                chrome?.tabs?.create ? chrome.tabs.create({ url }) : window.open(url, '_blank');
            } catch {
                const a = Object.assign(document.createElement('a'), {
                    href: url,
                    download: `anime-tracker-${new Date().toISOString().slice(0, 10)}.png`
                });
                document.body.appendChild(a); a.click(); a.remove();
            }
        } catch (e) {
            console.error('[ShareCard]', e);
            alert('Failed to create card: ' + (e?.message || e));
        }
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.ShareCard = { generateAndOpen, render };
})();