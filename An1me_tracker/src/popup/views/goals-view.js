(function () {
    'use strict';

    const GOAL_META = {
        daily:   { label: 'Daily watch time', field: 'targetMinutes', min: 5, max: 480, step: 5, unit: 'min' },
        weekly:  { label: 'Weekly episodes', field: 'targetEpisodes', min: 1, max: 100, step: 1, unit: 'ep' },
        monthly: { label: 'Monthly episodes', field: 'targetEpisodes', min: 1, max: 400, step: 1, unit: 'ep' }
    };

    const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };


    // ── Achievement families ─────────────────────────────────────────────
    // View-only grouping: cluster the engine's individual badges (each carrying
    // its own `tier`) into one "family" per shared metric. Each family renders
    // as a single card that evolves through its members' tiers. NO engine change
    // — members are looked up in the already-evaluated `badges` array by id.
    const ACHIEVEMENT_FAMILIES = [
        { id: 'episodes', group: 'volume', title: 'Episodes Watched', svg: 'hundred',
          members: ['starter_stack', 'century_club', 'marathoner_500', 'marathoner_1k'] },
        { id: 'watchtime', group: 'time', title: 'Watch Time', svg: 'hourglass',
          members: ['day_one_24h', 'time_traveler', 'time_keeper_250', 'time_legend'] },
        { id: 'series_finished', group: 'series', title: 'Series Finished', svg: 'check',
          members: ['completionist', 'completionist_10', 'completionist_25', 'completionist_50'] },
        { id: 'library', group: 'series', title: 'Library Size', svg: 'books',
          members: ['library_builder_10', 'library_builder', 'library_builder_75', 'library_builder_100'] },
        { id: 'longest_series', group: 'series', title: 'Longest Series', svg: 'sword',
          members: ['short_runner', 'season_runner', 'long_runner', 'epic_finisher'] },
        { id: 'movies', group: 'cinema', title: 'Movies Watched', svg: 'film',
          members: ['movie_night', 'movie_buff', 'double_feature', 'cinephile'] },
        { id: 'streak', group: 'streaks', title: 'Watch Streak', svg: 'flame',
          members: ['streak_starter', 'binge_week', 'dedication', 'unstoppable'] },
        { id: 'daily_eps', group: 'streaks', title: 'Daily Marathon', svg: 'bolt',
          members: ['power_hour', 'marathon_day', 'ultra_marathon', 'legendary_day'] },
        { id: 'weekend', group: 'lifestyle', title: 'Weekend Watching', svg: 'couch',
          members: ['weekend_mood', 'weekend_warrior', 'weekend_champion', 'weekend_legend'] },
        { id: 'patience', group: 'lifestyle', title: 'Loyal Companion', svg: 'sakura',
          members: ['steady_companion', 'seasoned_companion', 'patient_viewer', 'yearlong_companion'] },
        { id: 'comeback', group: 'lifestyle', title: 'Comebacks', svg: 'loop',
          members: ['comeback_kid', 'long_return', 'long_comeback', 'legendary_return'] },
        { id: 'night_owl', group: 'lifestyle', title: 'Night Owl', svg: 'moon',
          members: ['night_owl', 'night_owl_5', 'night_owl_20', 'night_owl_50'] },
        { id: 'early_bird', group: 'lifestyle', title: 'Early Bird', svg: 'sun',
          members: ['early_bird', 'early_bird_5', 'early_bird_20', 'early_bird_50'] },
        { id: 'shelf_keeper', group: 'lifestyle', title: 'Shelf Keeper', svg: 'books',
          members: ['shelf_keeper', 'shelf_manager', 'shelf_archivist', 'shelf_master'] },
        { id: 'picky_viewer', group: 'lifestyle', title: 'Picky Viewer', svg: 'noEntry',
          members: ['picky_viewer', 'selective_viewer', 'strict_curator', 'ruthless_curator'] }
    ];

    const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>';

    // Upright PS5-style trophy, filled with currentColor so the tier accent
    // (--ach-accent) tints it. The cup is the same across tiers, but each rank
    // adds an emblem so higher ranks read as more prestigious:
    //   bronze  → plain cup
    //   silver  → engraved star on the cup
    //   gold    → + a crown above the rim
    //   platinum→ + sparkles flanking the trophy
    const TROPHY_CUP = '<path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/>';
    const TROPHY_RANK = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

    function renderTrophy(tier) {
        const t = TROPHY_RANK[tier] != null ? tier : 'bronze';
        const rank = TROPHY_RANK[t];
        let extra = '';
        if (rank >= 1) extra += '<path class="ach-emblem" d="M12 6.7l.69 1.4 1.55.22-1.12 1.09.27 1.54L12 10.23l-1.38.72.27-1.54-1.12-1.09 1.55-.22z"/>';
        if (rank >= 2) extra += '<path d="M8 1.2l1.5 1.4L12 1l2.5 1.6L16 1.2v2.2H8z"/>';
        if (rank >= 3) extra += '<path d="M3 5.6l.5 1.15L4.65 7.3l-1.15.5L3 8.95l-.5-1.15L1.35 7.3 2.5 6.75zM21 5.6l.5 1.15 1.15.55-1.15.5-.5 1.15-.5-1.15-1.15-.5 1.15-.55z"/>';
        return `<svg class="ach-trophy ach-trophy--${t}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${TROPHY_CUP}${extra}</svg>`;
    }

    let _lastBadgeEvaluation = [];
    let _familyStateById = new Map();


    const MANUAL_OVERRIDE_MS = 60 * 60 * 1000;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]);
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

    // SVG progress ring. `pct` is 0..1. Renders track + arc, optional centred
    // icon / percentage label and a completed check overlay.
    function renderRing(pct, opts = {}) {
        const { size = 40, stroke = 4, iconHtml = '', showPct = false, completed = false } = opts;
        const r = (size - stroke) / 2;
        const circ = 2 * Math.PI * r;
        const clamped = Math.max(0, Math.min(1, pct || 0));
        const offset = circ * (1 - clamped);
        const c = size / 2;
        const center = completed
            ? `<span class="ach-ring-check">${CHECK_SVG}</span>`
            : '';
        const inner = showPct
            ? `<span class="ach-ring-pct">${Math.round(clamped * 100)}%</span>`
            : (iconHtml ? `<span class="ach-ring-icon">${iconHtml}</span>` : '');
        return `
            <span class="ach-ring" style="width:${size}px;height:${size}px">
                <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                    <circle class="ach-ring-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"/>
                    <circle class="ach-ring-fill" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"
                            stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
                </svg>
                ${inner}${center}
            </span>
        `;
    }

    // Build per-family view models from the already-evaluated `badges` array.
    function buildFamilyStates(badges) {
        const byId = new Map(badges.map(b => [b.id, b]));
        const states = [];
        for (const family of ACHIEVEMENT_FAMILIES) {
            const stages = family.members
                .map(id => byId.get(id))
                .filter(Boolean)
                .sort((a, b) => (a.progress.target || 0) - (b.progress.target || 0));
            if (stages.length === 0) {
                (window.PopupLogger?.warn || console.warn)('GoalsView', `Achievement family "${family.id}" has no matching badges`);
                continue;
            }
            const unlockedCount = stages.filter(s => s.unlocked).length;
            const completed = unlockedCount === stages.length;
            const top = stages[stages.length - 1];
            const nextStage = completed ? top : stages.find(s => !s.unlocked);
            const pct = completed ? 1 : (nextStage.progress.pct || 0);
            const tier = completed ? top.tier : nextStage.tier;
            states.push({
                id: family.id, group: family.group, title: family.title, svg: family.svg,
                stages, unlockedCount, completed, nextStage,
                pct, tier, statsLabel: formatBadgeProgress(nextStage),
                isClose: !completed && pct >= 0.8
            });
        }
        return states;
    }

    function renderFeaturedNextUp(states) {
        const candidate = states
            .filter(s => !s.completed && s.pct > 0)
            .sort((a, b) => b.pct - a.pct)[0];
        if (!candidate) return '';
        return `
            <section class="ach-featured" data-tier="${candidate.tier}" data-family="${candidate.id}"
                     role="button" tabindex="0" title="${escapeHtml(candidate.nextStage.desc)}">
                ${renderRing(candidate.pct, { size: 60, stroke: 5, iconHtml: renderTrophy(candidate.tier) })}
                <div class="ach-featured-body">
                    <span class="ach-featured-eyebrow">Next up</span>
                    <span class="ach-featured-title">${escapeHtml(candidate.title)}</span>
                    <span class="ach-featured-desc">${escapeHtml(candidate.nextStage.desc)}</span>
                    <div class="ach-featured-meta">
                        <span class="ach-featured-tier">${escapeHtml(TIER_LABEL[candidate.tier] || candidate.tier)}</span>
                        <span class="ach-featured-stats">${escapeHtml(candidate.statsLabel)}</span>
                        <span class="ach-featured-stats">${Math.round(candidate.pct * 100)}%</span>
                    </div>
                </div>
            </section>
        `;
    }

    function renderAchievementCard(state) {
        const cls = ['ach-card'];
        if (state.completed) cls.push('is-completed');
        else if (state.pct === 0) cls.push('is-locked');
        if (state.isClose) cls.push('is-close');
        const tierLabel = state.completed
            ? `${TIER_LABEL[state.tier] || ''} · Complete`
            : (TIER_LABEL[state.tier] || state.tier);
        return `
            <button type="button" class="${cls.join(' ')}" data-tier="${state.tier}"
                    data-group="${state.group}" data-family="${state.id}"
                    title="${escapeHtml(state.nextStage.desc)}">
                ${renderRing(state.pct, { size: 40, stroke: 4, iconHtml: renderTrophy(state.tier), completed: state.completed })}
                <span class="ach-card-body">
                    <span class="ach-card-title">${escapeHtml(state.title)}</span>
                    <span class="ach-card-tier">${escapeHtml(tierLabel)}</span>
                    <span class="ach-card-stats">${escapeHtml(state.statsLabel)}</span>
                </span>
            </button>
        `;
    }

    function renderAchievementsSection(states) {
        const totalStages = states.reduce((n, s) => n + s.stages.length, 0);
        const unlockedStages = states.reduce((n, s) => n + s.unlockedCount, 0);
        const cards = states.map(renderAchievementCard).join('');
        return `
            <section class="ach-section">
                <h2 class="goals-section-title">
                    Achievements
                    <span class="badges-count">${unlockedStages} / ${totalStages}</span>
                </h2>
                <div class="ach-grid">${cards}</div>
            </section>
        `;
    }

    function openAchievementDetail(familyId) {
        const state = _familyStateById.get(familyId);
        if (!state) return;
        document.getElementById('achDetailOverlay')?.remove();

        const groupTitle = (window.AnimeTracker?.AchievementsEngine?.GROUP_DEFS || [])
            .find(g => g.id === state.group)?.title || '';
        const nextPct = Math.round(state.pct * 100);

        const rows = state.stages.map(stage => {
            const isCurrent = !state.completed && stage === state.nextStage;
            const rowCls = stage.unlocked ? 'is-done' : (isCurrent ? 'is-current' : '');
            const val = stage.unlocked
                ? `<span class="ach-check">${CHECK_SVG}</span>`
                : escapeHtml(formatBadgeProgress(stage));
            return `
                <div class="ach-stage-row ${rowCls}" data-tier="${stage.tier}">
                    <span class="ach-stage-trophy" data-tier="${stage.tier}">${renderTrophy(stage.tier)}</span>
                    <span class="ach-stage-info">
                        <span class="ach-stage-name">${escapeHtml(stage.title)}</span>
                        <span class="ach-stage-desc">${escapeHtml(stage.desc)}</span>
                    </span>
                    <span class="ach-stage-meta">
                        <span class="ach-stage-tier">${escapeHtml(TIER_LABEL[stage.tier] || stage.tier)}</span>
                        <span class="ach-stage-val">${val}</span>
                    </span>
                </div>
            `;
        }).join('');

        const nextBlock = state.completed
            ? `<div class="ach-detail-next is-complete">
                    <span class="ach-detail-next-icon">${CHECK_SVG}</span>
                    <span class="ach-detail-next-main">All ${state.stages.length} tiers earned — maxed out</span>
               </div>`
            : `<div class="ach-detail-next">
                    <div class="ach-detail-next-top">
                        <span class="ach-detail-next-label">Next tier · ${escapeHtml(TIER_LABEL[state.nextStage.tier] || state.nextStage.tier)}</span>
                        <span class="ach-detail-next-val">${escapeHtml(state.statsLabel)} · ${nextPct}%</span>
                    </div>
                    <div class="goal-progress-track"><div class="goal-progress-bar ach-bar" style="width:${nextPct}%"></div></div>
                    <div class="ach-detail-next-desc">${escapeHtml(state.nextStage.desc)}</div>
               </div>`;

        const overlay = document.createElement('div');
        overlay.id = 'achDetailOverlay';
        overlay.className = 'dialog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="dialog ach-detail" data-tier="${state.tier}">
                <div class="ach-detail-head">
                    ${renderRing(state.pct, { size: 52, stroke: 4, iconHtml: renderTrophy(state.tier), completed: state.completed })}
                    <div class="ach-detail-titles">
                        ${groupTitle ? `<span class="ach-detail-group">${escapeHtml(groupTitle)}</span>` : ''}
                        <div class="ach-detail-title">${escapeHtml(state.title)}</div>
                        <div class="ach-detail-sub">${state.unlockedCount} of ${state.stages.length} tiers earned</div>
                    </div>
                    <button class="dialog-close" type="button" aria-label="Close" data-close>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
                    </button>
                </div>
                ${nextBlock}
                <div class="ach-detail-list">${rows}</div>
            </div>
        `;

        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-close]')) close();
        });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
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
            const previousGoalSettings = goalSettings;
            params.goalSettings = effectiveGoalSettings;
            if (typeof params.onGoalsChanged === 'function') {
                params.onGoalsChanged(effectiveGoalSettings);
            }
            chrome.storage.local.set({ goalSettings: effectiveGoalSettings }).catch((err) => {
                (window.PopupLogger?.warn || console.warn)('GoalsView', 'Failed to save smart goals — reverting in-memory state:', err);
                params.goalSettings = previousGoalSettings;
                if (typeof params.onGoalsChanged === 'function') {
                    params.onGoalsChanged(previousGoalSettings);
                }
                try { render(container, { ...params, goalSettings: previousGoalSettings }); } catch {}
            });
        }

        const badges = AchievementsEngine.evaluateBadges(animeData, index, hourIndex, { badgeState });
        const goals = AchievementsEngine.evaluateGoals(effectiveGoalSettings, index);
        _lastBadgeEvaluation = badges;

        const familyStates = buildFamilyStates(badges);
        _familyStateById = new Map(familyStates.map(s => [s.id, s]));

        const isEmpty = !index?.totals?.episodes || index.totals.episodes === 0;

        container.innerHTML = `
            <div class="goals-view-inner">
                ${isEmpty ? renderEmptyBanner() : ''}
                ${renderSmartGoalsBanner(smartPlan, isEmpty)}
                ${renderGoalsSection(goals, effectiveGoalSettings, smartPlan)}
                ${renderFeaturedNextUp(familyStates)}
                ${renderAchievementsSection(familyStates)}
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
                (window.PopupLogger?.warn || console.warn)('GoalsView', 'Failed to save goal:', err);
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


        // Achievement card / featured taps (delegated).
        const section = container.querySelector('.ach-section');
        if (section) {
            section.addEventListener('click', (e) => {
                const card = e.target.closest('.ach-card');
                if (card && section.contains(card)) {
                    openAchievementDetail(card.dataset.family);
                }
            });
        }

        const featured = container.querySelector('.ach-featured');
        if (featured) {
            featured.addEventListener('click', () => openAchievementDetail(featured.dataset.family));
            featured.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openAchievementDetail(featured.dataset.family);
                }
            });
        }
    }

    function getLastBadgeEvaluation() {
        return _lastBadgeEvaluation;
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.GoalsView = {
        render,
        getLastBadgeEvaluation
    };
})();
