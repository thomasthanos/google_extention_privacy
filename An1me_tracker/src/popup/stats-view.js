/**
 * Anime Tracker — Stats View  (v2)
 * Full-page dashboard: hero streak, tiles, activity heatmap, monthly bars, library.
 * Pure DOM + SVG, no deps, CSP-clean.
 */
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /* ── tiny DOM helpers ── */
    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const k in attrs) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
            else node.setAttribute(k, attrs[k]);
        }
        for (const c of children) {
            if (c == null) continue;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return node;
    }

    function svgEl(tag, attrs = {}) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const k in attrs) node.setAttribute(k, attrs[k]);
        return node;
    }

    function fmtH(sec) {
        const h = sec / 3600;
        if (h === 0) return '0h';
        if (h >= 100) return Math.round(h) + 'h';
        if (h >= 10) return h.toFixed(1) + 'h';
        return h.toFixed(1) + 'h';
    }

    function fmtDayKey(dk) {
        const [y, m, d] = dk.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /* ══════════════════════════════════════════════════════════
       1. HERO STREAK CARD — full-width, centered
    ══════════════════════════════════════════════════════════ */
    function renderStreakHero(streak) {
        const cur = streak.currentStreak;
        const best = streak.longestStreak;
        const active = cur > 0;

        const hero = el('div', { class: `streak-hero ${active ? 'streak-hero--active' : 'streak-hero--idle'}` });

        // Left: flame + big number
        const left = el('div', { class: 'streak-hero-main' }, [
            el('span', { class: 'streak-hero-flame', text: active ? '🔥' : '💤' }),
            el('div', { class: 'streak-hero-center' }, [
                el('div', { class: 'streak-hero-num', text: String(cur) }),
                el('div', { class: 'streak-hero-label', text: cur === 1 ? 'day streak' : 'days streak' })
            ])
        ]);

        // Right: best + message
        const msg = active
            ? (cur >= 30 ? 'Legendary run! 🏆' : cur >= 14 ? 'On fire! Keep it up.' : cur >= 7 ? 'Great week streak!' : 'Keep the momentum.')
            : 'Watch an episode to start a streak!';

        const right = el('div', { class: 'streak-hero-side' }, [
            el('div', { class: 'streak-hero-best' }, [
                el('span', { class: 'streak-hero-best-label', text: 'Personal best' }),
                el('span', { class: 'streak-hero-best-val', text: `${best} day${best === 1 ? '' : 's'}` })
            ]),
            el('div', { class: 'streak-hero-msg', text: msg })
        ]);

        hero.appendChild(left);
        hero.appendChild(right);
        return hero;
    }

    /* ══════════════════════════════════════════════════════════
       2. STATS TILES — 3 across
    ══════════════════════════════════════════════════════════ */
    function renderTiles(totals, weekly) {
        const tiles = [
            {
                icon: '📺',
                value: String(weekly.episodes),
                label: 'This week',
                sub: weekly.activeDays + '/7 active days'
            },
            {
                icon: '⏱',
                value: fmtH(totals.seconds),
                label: 'Total watched',
                sub: totals.episodes + ' episodes'
            },
            {
                icon: '📅',
                value: String(totals.activeDays),
                label: 'Active days',
                sub: totals.animes + ' anime tracked'
            }
        ];

        return el('div', { class: 'stats-tiles' }, tiles.map(t =>
            el('div', { class: 'stats-tile' }, [
                el('div', { class: 'stats-tile-icon', text: t.icon }),
                el('div', { class: 'stats-tile-value', text: t.value }),
                el('div', { class: 'stats-tile-label', text: t.label }),
                el('div', { class: 'stats-tile-sub', text: t.sub })
            ])
        ));
    }

    /* ══════════════════════════════════════════════════════════
       3. ACTIVITY HEATMAP — scaled SVG (no scrollbar)
          Weeks auto-calculated to fill container at ~12px cells.
          Uses viewBox scaling so SVG always fits width=100%.
    ══════════════════════════════════════════════════════════ */
    function renderActivity(byDay) {
        // Fixed 16 weeks — fits comfortably at any reasonable popup width (≥360px)
        const WEEKS = 16;
        const CELL = 13;
        const GAP = 3;
        const LBL_W = 18; // weekday labels
        const LBL_H = 16; // month labels on top
        const svgW = LBL_W + WEEKS * (CELL + GAP);
        const svgH = LBL_H + 7 * (CELL + GAP);

        const root = svgEl('svg', {
            class: 'heatmap-svg',
            viewBox: `0 0 ${svgW} ${svgH}`,
            width: String(svgW),
            height: String(svgH),
            preserveAspectRatio: 'xMinYMid meet',
            role: 'img',
            'aria-label': 'Episode activity heatmap'
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDow = today.getDay();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - ((WEEKS - 1) * 7 + endDow));

        let max = 0;
        for (const v of byDay.values()) if (v.episodes > max) max = v.episodes;

        const palette = [
            'rgba(255,255,255,0.06)',
            'rgba(224,80,30,0.25)',
            'rgba(224,80,30,0.48)',
            'rgba(224,80,30,0.72)',
            '#e0501e'
        ];

        function bucket(n) {
            if (!n || !max) return 0;
            const r = n / max;
            if (r <= 0.2) return 1;
            if (r <= 0.45) return 2;
            if (r <= 0.72) return 3;
            return 4;
        }

        // Weekday labels M/W/F
        ['', 'M', '', 'W', '', 'F', ''].forEach((lbl, r) => {
            if (!lbl) return;
            const t = svgEl('text', {
                x: '2', y: String(LBL_H + r * (CELL + GAP) + CELL - 2),
                class: 'hm-lbl', 'font-size': '8'
            });
            t.textContent = lbl;
            root.appendChild(t);
        });

        // Month labels
        let lastMonth = -1;
        for (let w = 0; w < WEEKS; w++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + w * 7);
            if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
                lastMonth = d.getMonth();
                const t = svgEl('text', {
                    x: String(LBL_W + w * (CELL + GAP)),
                    y: '11',
                    class: 'hm-lbl', 'font-size': '8'
                });
                t.textContent = d.toLocaleDateString(undefined, { month: 'short' });
                root.appendChild(t);
            }
        }

        // Cells
        for (let w = 0; w < WEEKS; w++) {
            for (let d = 0; d < 7; d++) {
                const cellDate = new Date(startDate);
                cellDate.setDate(startDate.getDate() + w * 7 + d);
                if (cellDate > today) continue;

                const dk = window.AnimeTracker.StatsEngine.dayKey(cellDate);
                const bkt = byDay.get(dk);
                const lvl = bucket(bkt?.episodes || 0);

                const rect = svgEl('rect', {
                    x: String(LBL_W + w * (CELL + GAP)),
                    y: String(LBL_H + d * (CELL + GAP)),
                    width: String(CELL), height: String(CELL),
                    rx: '2.5', ry: '2.5',
                    fill: palette[lvl],
                    class: 'hm-cell'
                });
                const tt = svgEl('title');
                tt.textContent = bkt
                    ? `${fmtDayKey(dk)}: ${bkt.episodes} ep · ${fmtH(bkt.seconds)}`
                    : `${fmtDayKey(dk)}: no activity`;
                rect.appendChild(tt);
                root.appendChild(rect);
            }
        }

        // Legend row
        const legend = el('div', { class: 'hm-legend' }, [
            el('span', { class: 'hm-legend-txt', text: 'Less' }),
            ...palette.map(c => {
                const s = document.createElementNS(SVG_NS, 'svg');
                s.setAttribute('width', '11'); s.setAttribute('height', '11');
                s.setAttribute('viewBox', '0 0 11 11');
                const r = svgEl('rect', { width: '11', height: '11', rx: '2.5', ry: '2.5', fill: c });
                s.appendChild(r);
                return s;
            }),
            el('span', { class: 'hm-legend-txt', text: 'More' })
        ]);

        return el('div', { class: 'hm-wrap' }, [
            el('div', { class: 'hm-svg-wrap' }, [root]),
            legend
        ]);
    }

    /* ══════════════════════════════════════════════════════════
       4. MONTHLY BARS — last 12 months
    ══════════════════════════════════════════════════════════ */
    function renderMonthlyBars(byMonth) {
        const months = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const mk = window.AnimeTracker.StatsEngine.monthKey(d);
            months.push({ mk, date: d, seconds: byMonth.get(mk) || 0 });
        }
        const max = Math.max(1, ...months.map(m => m.seconds));

        const VW = 370, VH = 120;
        const pL = 28, pR = 6, pT = 8, pB = 24;
        const iW = VW - pL - pR;
        const iH = VH - pT - pB;
        const step = iW / months.length;
        const bw = step * 0.65;

        const root = svgEl('svg', {
            class: 'bars-svg',
            viewBox: `0 0 ${VW} ${VH}`,
            width: String(VW),
            height: String(VH),
            preserveAspectRatio: 'xMinYMid meet',
            role: 'img',
            'aria-label': 'Hours watched per month'
        });

        // y-axis label
        const yLbl = svgEl('text', { x: '2', y: String(pT + 9), class: 'bar-lbl', 'font-size': '8' });
        yLbl.textContent = fmtH(max);
        root.appendChild(yLbl);

        // Baseline
        root.appendChild(svgEl('line', {
            x1: String(pL), y1: String(pT + iH),
            x2: String(pL + iW), y2: String(pT + iH),
            stroke: 'rgba(255,255,255,0.08)', 'stroke-width': '1'
        }));

        months.forEach((m, i) => {
            const barH = (m.seconds / max) * iH;
            const x = pL + step * i + (step - bw) / 2;
            const y = pT + iH - barH;

            // Bar with gradient for active months
            let fill;
            if (m.seconds > 0) {
                const gradId = `bg${i}`;
                const defs = svgEl('defs');
                const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
                const s1 = svgEl('stop', { offset: '0%', 'stop-color': '#ff8a5c' });
                const s2 = svgEl('stop', { offset: '100%', 'stop-color': '#c0390e' });
                grad.appendChild(s1); grad.appendChild(s2);
                defs.appendChild(grad);
                root.appendChild(defs);
                fill = `url(#${gradId})`;
            } else {
                fill = 'rgba(255,255,255,0.05)';
            }

            const rect = svgEl('rect', {
                x: String(x), y: String(Math.max(pT, y)),
                width: String(bw), height: String(Math.max(0, barH)),
                rx: '3', ry: '3',
                fill,
                class: 'bar-rect'
            });
            const tt = svgEl('title');
            tt.textContent = `${m.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${fmtH(m.seconds)}`;
            rect.appendChild(tt);
            root.appendChild(rect);

            // x label every other month
            if (i % 2 === 0 || m.date.getMonth() === 0) {
                const t = svgEl('text', {
                    x: String(x + bw / 2), y: String(VH - 6),
                    'text-anchor': 'middle', class: 'bar-lbl', 'font-size': '8'
                });
                t.textContent = m.date.toLocaleDateString(undefined, { month: 'short' });
                root.appendChild(t);
            }
        });

        return el('div', { class: 'bars-wrap' }, [root]);
    }

    /* ══════════════════════════════════════════════════════════
       5. LIBRARY TABLE — watching/completed/on-hold/dropped
    ══════════════════════════════════════════════════════════ */
    function renderLibrary(categories) {
        const sections = [
            { key: 'watching',   label: 'Watching',   color: '#4fb3e0' },
            { key: 'completed',  label: 'Completed',  color: '#5cd197' },
            { key: 'onHold',     label: 'On hold',    color: '#f0c040' },
            { key: 'dropped',    label: 'Dropped',    color: '#6b7694' }
        ];

        const wrap = el('div', { class: 'library-wrap' });
        let any = false;

        for (const s of sections) {
            const rows = categories[s.key] || [];
            if (!rows.length) continue;
            any = true;

            const section = el('div', { class: 'lib-section' });
            section.appendChild(
                el('div', { class: 'lib-heading' }, [
                    el('span', { class: 'lib-dot', style: `background:${s.color}` }),
                    el('span', { class: 'lib-heading-label', text: s.label }),
                    el('span', { class: 'lib-count', text: String(rows.length) })
                ])
            );

            const list = el('div', { class: 'lib-list' });
            rows.slice(0, 50).forEach(r => {
                const pct = r.total > 0 ? Math.min(100, Math.round((r.watched / r.total) * 100)) : 0;
                const row = el('div', { class: 'lib-row', title: r.title || r.slug });
                row.appendChild(el('span', { class: 'lib-title', text: r.title || r.slug }));
                row.appendChild(el('span', { class: 'lib-prog', text: r.total ? `${r.watched}/${r.total}` : `${r.watched}` }));
                const track = el('span', { class: 'lib-bar' });
                const fill  = el('span', { class: 'lib-bar-fill', style: `width:${pct}%;background:${s.color}` });
                track.appendChild(fill);
                row.appendChild(track);
                list.appendChild(row);
            });

            section.appendChild(list);
            wrap.appendChild(section);
        }

        if (!any) {
            wrap.appendChild(el('div', { class: 'stats-empty', text: 'Start watching anime on an1me.to to see your library.' }));
        }
        return wrap;
    }

    /* ══════════════════════════════════════════════════════════
       MAIN RENDER
    ══════════════════════════════════════════════════════════ */
    function render(container, animeData) {
        if (!container) return;
        container.innerHTML = '';

        const { StatsEngine } = window.AnimeTracker;
        const index    = StatsEngine.buildWatchIndex(animeData);
        const streak   = StatsEngine.computeStreak(index);
        const weekly   = StatsEngine.windowStats(index, 7);
        const cats     = StatsEngine.categorizeAnime(animeData);

        // Share button
        const shareBtn = el('button', {
            class: 'share-btn',
            type: 'button',
            title: 'Generate weekly share card'
        }, [
            el('span', { text: '📸' }),
            el('span', { text: 'Share week' })
        ]);
        shareBtn.addEventListener('click', () => {
            if (window.AnimeTracker.ShareCard) {
                shareBtn.disabled = true;
                shareBtn.querySelector('span:last-child').textContent = 'Generating…';
                window.AnimeTracker.ShareCard.generateAndOpen(animeData, index).finally(() => {
                    shareBtn.disabled = false;
                    shareBtn.querySelector('span:last-child').textContent = 'Share week';
                });
            }
        });

        // Section builder helper
        function section(title, content, cls = '') {
            return el('div', { class: `stat-card ${cls}` }, [
                title ? el('div', { class: 'stat-card-title', text: title }) : null,
                content
            ].filter(Boolean));
        }

        container.appendChild(renderStreakHero(streak));
        container.appendChild(renderTiles(index.totals, weekly));
        container.appendChild(shareBtn);
        container.appendChild(section('Activity · last 16 weeks', renderActivity(index.byDay)));
        container.appendChild(section('Hours per month', renderMonthlyBars(index.byMonth)));
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.StatsView = { render };
})();
