(function () {
    'use strict';

    const GOAL_META = {
        daily:   { label: 'Daily watch time', field: 'targetMinutes', min: 5, max: 480, step: 5, unit: 'min' },
        weekly:  { label: 'Weekly episodes', field: 'targetEpisodes', min: 1, max: 100, step: 1, unit: 'ep' },
        monthly: { label: 'Monthly episodes', field: 'targetEpisodes', min: 1, max: 400, step: 1, unit: 'ep' }
    };

    const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

    // Inline SVG icon registry. Each id matches BADGE_DEFS[].svg.
    // Style: 24×24 viewBox, currentColor stroke, no fill (tier color via CSS).
    const SVG_ICONS = {
        sprout: '<path d="M12 22V11"/><path d="M12 11c0-3 2-5 5-5-1 3-3 5-5 5z"/><path d="M12 14c0-3-2-5-5-5 1 3 3 5 5 5z"/>',
        hundred: '<circle cx="12" cy="12" r="9"/><path d="M8 9v6M16 9v6M10.5 9h3v6h-3z"/>',
        rocket: '<path d="M12 2c3 3 5 7 5 11l-3 2-2-2-2 2-3-2c0-4 2-8 5-11z"/><path d="M9 17l-2 4 4-1M15 17l2 4-4-1"/>',
        trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M5 5v2a3 3 0 0 0 3 3M19 5v2a3 3 0 0 1-3 3"/><path d="M10 14h4v3h-4z"/><path d="M8 21h8"/>',
        hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
        books: '<path d="M4 4h6v16H4z"/><path d="M14 4h6v16h-6z"/><path d="M4 8h6M14 8h6M4 12h6M14 12h6"/>',
        crown: '<path d="M3 18h18l-2-9-4 4-3-7-3 7-4-4-2 9z"/><path d="M3 21h18"/>',
        book: '<path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M4 17h15"/>',
        runner: '<circle cx="14" cy="5" r="2"/><path d="M11 22l3-7-2-3 4-3 3 4"/><path d="M5 14l3-3 4 1"/>',
        sword: '<path d="M14 5l5-3 1 1-3 5 3 3-2 2-3-3-7 7-3-1 1-3 7-7-3-3 4-1z"/>',
        clapper: '<path d="M3 8h18v12H3z"/><path d="M3 8l3-4h12l3 4"/><path d="M7 4l2 4M12 4l2 4M17 4l2 4"/>',
        film: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 8h3M3 12h3M3 16h3M18 8h3M18 12h3M18 16h3"/>',
        bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
        flame: '<path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 1z"/>',
        calendar7: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 9h18M8 3v4M16 3v4"/><path d="M8 14l2 3 4-5"/>',
        gem: '<path d="M6 9l3-5h6l3 5-6 11z"/><path d="M6 9h12M9 4l3 5 3-5"/>',
        volcano: '<path d="M3 21l5-10h8l5 10z"/><path d="M9 11c0-3 1-5 3-7 1 2 1 3 0 5 1 1 2 1 3 2"/>',
        moon: '<path d="M21 13a9 9 0 1 1-9-10 7 7 0 0 0 9 10z"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
        couch: '<path d="M3 14v5h2v-2h14v2h2v-5a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3z"/><path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/>',
        sakura: '<circle cx="12" cy="12" r="2"/><path d="M12 4c-1 2-1 4 0 6M12 14c-1 2-1 4 0 6M4 12c2-1 4-1 6 0M14 12c2-1 4-1 6 0M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/>',
        loop: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
        noEntry: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'
    };

    let _lastBadgeEvaluation = [];
    const MANUAL_OVERRIDE_MS = 3 * 24 * 60 * 60 * 1000;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
    }

    function renderSvgIcon(id, fallbackEmoji) {
        const paths = SVG_ICONS[id];
        if (!paths) return `<span class="badge-emoji-fallback">${escapeHtml(fallbackEmoji || '★')}</span>`;
        return `<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    }

    function formatGoalProgress(goal) {
        if (goal.unit === 'seconds') {
            const currentMin = Math.round(goal.current / 60);
            const targetMin = Math.round(goal.target / 60);
            return `${currentMin} / ${targetMin} min`;
        }
        return `${goal.current} / ${goal.target} ep`;
    }

    function formatBadgeProgress(badge) {
        const { current, target, unit } = badge.progress;
        if (unit === 'seconds') {
            return `${Math.round(current / 3600)} / ${Math.round(target / 3600)}h`;
        }
        return `${current} / ${target}`;
    }

    function formatUnlockedAt(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function badgeTooltip(badge) {
        const tier = TIER_LABEL[badge.tier] || '';
        const status = badge.unlocked
            ? (badge.unlockedAt ? `Unlocked ${formatUnlockedAt(badge.unlockedAt)} • ${formatBadgeProgress(badge)}` : `Unlocked • ${formatBadgeProgress(badge)}`)
            : `Locked • ${formatBadgeProgress(badge)} • ${Math.round((badge.progress.pct || 0) * 100)}%`;
        return `${badge.desc} • ${tier} • ${status}`;
    }

    function renderEmptyBanner() {
        return `
            <section class="goals-empty-banner">
                <div class="goals-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                         stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="8" r="6"/>
                        <polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88"/>
                    </svg>
                </div>
                <div class="goals-empty-text">
                    <h3>Start your journey</h3>
                    <p>Watch anime on an1me.to to fill your goals and unlock your first badges.</p>
                </div>
            </section>
        `;
    }

    function renderSmartGoalsBanner(smartPlan, isEmpty) {
        if (!smartPlan?.summary?.text) return '';
        return `
            <div class="goals-smart-banner${isEmpty ? ' goals-smart-banner--empty' : ''}">
                <span class="goals-smart-badge">Smart goals</span>
                <span class="goals-smart-text">${escapeHtml(smartPlan.summary.text)}</span>
            </div>
        `;
    }

    function renderGoalsSection(goals, goalSettings, smartPlan) {
        const rows = Object.entries(GOAL_META).map(([key, meta]) => {
            const goal = goals[key];
            const pct = Math.round((goal.pct || 0) * 100);
            const currentTarget = goalSettings?.[key]?.[meta.field]
                ?? (meta.field === 'targetMinutes' ? 60 : (key === 'weekly' ? 5 : 20));
            const smart = smartPlan?.suggestions?.[key] || null;
            const smartLabel = smart
                ? (smart.manualHold ? 'Suggest' : 'Auto')
                : '';
            const smartLabelClass = smart?.manualHold
                ? 'goal-card-chip goal-card-chip--suggested'
                : 'goal-card-chip';
            const smartNote = smart
                ? (smart.manualHold
                    ? `Manual hold active. Suggested ${smart.display}.`
                    : smart.note)
                : '';
            return `
                <div class="goal-card" data-goal-key="${key}">
                    <div class="goal-card-head">
                        <span class="goal-card-title-wrap">
                            <span class="goal-card-title">${escapeHtml(meta.label)}</span>
                            ${smart ? `<span class="${smartLabelClass}">${escapeHtml(smartLabel)}</span>` : ''}
                        </span>
                        <span class="goal-card-progress">${escapeHtml(formatGoalProgress(goal))}</span>
                    </div>
                    ${smartNote ? `<div class="goal-card-note">${escapeHtml(smartNote)}</div>` : ''}
                    <div class="goal-progress-track">
                        <div class="goal-progress-bar" style="width:${pct}%"></div>
                    </div>
                    <div class="goal-card-foot">
                        <span class="goal-target-label">Target</span>
                        <div class="goal-stepper" data-goal-key="${key}" data-goal-field="${meta.field}"
                             data-min="${meta.min}" data-max="${meta.max}" data-step="${meta.step}">
                            <button type="button" class="goal-stepper-btn" data-stepper-action="dec" aria-label="Decrease">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                                     stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>
                            </button>
                            <span class="goal-stepper-value" data-stepper-value>${currentTarget}</span>
                            <span class="goal-stepper-unit">${escapeHtml(meta.unit)}</span>
                            <button type="button" class="goal-stepper-btn" data-stepper-action="inc" aria-label="Increase">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                                     stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="goals-section">
                <h2 class="goals-section-title">Goals</h2>
                <div class="goals-grid">${rows}</div>
            </section>
        `;
    }

    function renderBadgeTile(badge) {
        const pct = Math.round((badge.progress.pct || 0) * 100);
        const lockedClass = badge.unlocked ? 'badge-tile--unlocked' : 'badge-tile--locked';
        const newlyClass = badge.justUnlocked ? ' is-newly-unlocked' : '';
        const iconHtml = renderSvgIcon(badge.svg, badge.icon);
        return `
            <div class="badge-tile ${lockedClass} badge-tier-${badge.tier}${newlyClass}"
                 title="${escapeHtml(badgeTooltip(badge))}">
                <div class="badge-tile-main">
                    <div class="badge-tile-icon-wrap">${iconHtml}</div>
                    <div class="badge-title">${escapeHtml(badge.title)}</div>
                    <div class="badge-progress badge-progress--top${badge.unlocked ? ' badge-progress--unlocked' : ''}">${escapeHtml(formatBadgeProgress(badge))}</div>
                    <div class="badge-track-row">
                        <div class="badge-tile-mini-track"><div class="badge-tile-mini-bar" style="width:${badge.unlocked ? 100 : pct}%"></div></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderBadgesSection(badges) {
        const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
        const groupDefs = AchievementsEngine?.GROUP_DEFS || [{ id: 'volume', title: 'All', icon: '★' }];

        const totalUnlocked = badges.filter(b => b.unlocked).length;

        const groupSections = groupDefs.map(group => {
            const groupBadges = badges.filter(b => b.group === group.id);
            if (groupBadges.length === 0) return '';
            const unlocked = groupBadges.filter(b => b.unlocked);
            const tiles = [...unlocked, ...groupBadges.filter(b => !b.unlocked)]
                .map(renderBadgeTile)
                .join('');
            return `
                <details class="badge-group-section">
                    <summary class="badge-group-summary">
                        <span class="badge-group-icon">${escapeHtml(group.icon)}</span>
                        <span class="badge-group-title">${escapeHtml(group.title)}</span>
                        <span class="badge-group-count">${unlocked.length} / ${groupBadges.length}</span>
                        <svg class="badge-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </summary>
                    <div class="badges-grid">${tiles}</div>
                </details>
            `;
        }).join('');

        return `
            <section class="badges-section">
                <h2 class="goals-section-title">
                    Achievements
                    <span class="badges-count">${totalUnlocked} / ${badges.length}</span>
                </h2>
                ${groupSections}
            </section>
        `;
    }

    function renderNextUpSection(badges) {
        const nextUp = badges
            .filter(b => !b.unlocked && b.progress.target > 0)
            .sort((a, b) => b.progress.pct - a.progress.pct)
            .slice(0, 3);
        if (nextUp.length === 0) return '';

        const items = nextUp.map(b => {
            const pct = Math.round((b.progress.pct || 0) * 100);
            return `
                <div class="badge-next-up-item">
                    <div class="badge-next-up-head">
                        <span class="badge-next-up-icon badge-tier-${b.tier}">${renderSvgIcon(b.svg, b.icon)}</span>
                        <span class="badge-next-up-title-wrap">
                            <span class="badge-next-up-title">${escapeHtml(b.title)}</span>
                        </span>
                        <span class="badge-next-up-pct">${pct}%</span>
                    </div>
                    <div class="goal-progress-track">
                        <div class="goal-progress-bar" style="width:${pct}%"></div>
                    </div>
                    <div class="badge-next-up-desc">${escapeHtml(b.desc)}</div>
                    <div class="badge-next-up-meta">
                        <span class="badge-next-up-target">${escapeHtml(formatBadgeProgress(b))}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="next-up-section">
                <h2 class="goals-section-title">Next up</h2>
                <div class="next-up-list">${items}</div>
            </section>
        `;
    }

    function render(container, params) {
        if (!container) return;
        container.removeAttribute('hidden');

        const { animeData, index, hourIndex, goalSettings, badgeState } = params || {};
        const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
        if (!AchievementsEngine) {
            container.textContent = 'Goals unavailable.';
            return;
        }

        const smartPlan = AchievementsEngine.buildSmartGoalPlan
            ? AchievementsEngine.buildSmartGoalPlan(animeData, index, goalSettings)
            : null;
        const effectiveGoalSettings = smartPlan?.goalSettings || goalSettings;

        if (smartPlan?.shouldPersist) {
            params.goalSettings = effectiveGoalSettings;
            if (typeof params.onGoalsChanged === 'function') {
                params.onGoalsChanged(effectiveGoalSettings);
            }
            chrome.storage.local.set({ goalSettings: effectiveGoalSettings }).catch((err) => {
                console.warn('[GoalsView] Failed to save smart goals:', err);
            });
        }

        const badges = AchievementsEngine.evaluateBadges(animeData, index, hourIndex, { badgeState });
        const goals = AchievementsEngine.evaluateGoals(effectiveGoalSettings, index);
        _lastBadgeEvaluation = badges;

        const isEmpty = !index?.totals?.episodes || index.totals.episodes === 0;

        container.innerHTML = `
            <div class="goals-view-inner">
                ${isEmpty ? renderEmptyBanner() : ''}
                ${renderSmartGoalsBanner(smartPlan, isEmpty)}
                ${renderGoalsSection(goals, effectiveGoalSettings, smartPlan)}
                ${renderNextUpSection(badges)}
                ${renderBadgesSection(badges)}
            </div>
        `;

        params.goalSettings = effectiveGoalSettings;
        wireInputs(container, params);
    }

    function updateGoalCardInPlace(container, params, key, newTarget) {
        const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
        if (!AchievementsEngine) return;

        const provisionalSettings = {
            ...(params.goalSettings || {}),
            [key]: { ...((params.goalSettings || {})[key] || {}), [GOAL_META[key].field]: newTarget }
        };
        const goals = AchievementsEngine.evaluateGoals(provisionalSettings, params.index);
        const goal = goals[key];
        if (!goal) return;

        const card = container.querySelector(`.goal-card[data-goal-key="${key}"]`);
        if (!card) return;

        const progressText = card.querySelector('.goal-card-progress');
        if (progressText) progressText.textContent = formatGoalProgress(goal);

        const bar = card.querySelector('.goal-progress-bar');
        if (bar) bar.style.width = `${Math.round((goal.pct || 0) * 100)}%`;
    }

    function wireInputs(container, params) {
        const steppers = container.querySelectorAll('.goal-stepper');

        const persist = async (key, field, value) => {
            const now = new Date();
            const nextSettings = {
                ...(params.goalSettings || {}),
                [key]: {
                    ...((params.goalSettings || {})[key] || {}),
                    [field]: value,
                    smartManaged: true,
                    updatedAt: now.toISOString(),
                    manualOverrideUntil: new Date(now.getTime() + MANUAL_OVERRIDE_MS).toISOString()
                }
            };
            params.goalSettings = nextSettings;
            if (typeof params.onGoalsChanged === 'function') {
                params.onGoalsChanged(nextSettings);
            }
            try {
                await chrome.storage.local.set({ goalSettings: nextSettings });
            } catch (err) {
                console.warn('[GoalsView] Failed to save goal:', err);
            }
        };

        steppers.forEach(stepper => {
            const key = stepper.dataset.goalKey;
            const field = stepper.dataset.goalField;
            const min = Number(stepper.dataset.min);
            const max = Number(stepper.dataset.max);
            const step = Number(stepper.dataset.step) || 1;
            const valueEl = stepper.querySelector('[data-stepper-value]');
            let saveTimer = null;

            const apply = (delta) => {
                const cur = Number(valueEl.textContent) || min;
                const next = Math.max(min, Math.min(max, cur + delta));
                if (next === cur) return;
                valueEl.textContent = next;
                updateGoalCardInPlace(container, params, key, next);
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => persist(key, field, next), 400);
            };

            stepper.querySelectorAll('[data-stepper-action]').forEach(btn => {
                const dir = btn.dataset.stepperAction === 'inc' ? 1 : -1;
                let holdTimer = null;
                let repeatTimer = null;

                const startHold = () => {
                    holdTimer = setTimeout(() => {
                        repeatTimer = setInterval(() => apply(dir * step), 80);
                    }, 350);
                };
                const stopHold = () => {
                    clearTimeout(holdTimer);
                    clearInterval(repeatTimer);
                    holdTimer = null;
                    repeatTimer = null;
                };

                btn.addEventListener('click', () => apply(dir * step));
                btn.addEventListener('mousedown', startHold);
                btn.addEventListener('mouseup', stopHold);
                btn.addEventListener('mouseleave', stopHold);
                btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); }, { passive: false });
                btn.addEventListener('touchend', stopHold);
            });
        });
    }

    function getLastBadgeEvaluation() {
        return _lastBadgeEvaluation;
    }

    function maybeDetectUnlocks(prevBadges, nextBadges) {
        const AchievementsEngine = window.AnimeTracker?.AchievementsEngine;
        if (!AchievementsEngine) return [];
        return AchievementsEngine.diffUnlocks(prevBadges, nextBadges);
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.GoalsView = {
        render,
        getLastBadgeEvaluation,
        maybeDetectUnlocks
    };
})();
