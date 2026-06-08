(function () {
    'use strict';

    // Toast / notification UI — extracted from popup/main.js.
    // Self-contained (own DOM, no popup state). Consumed via AT.showToast / AT.showAuthToast.
    const AT = (window.AnimeTracker = window.AnimeTracker || {});

    function showAuthToast(message, type = 'error') {
        const existing = document.getElementById('authToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'authToast';
        toast.textContent = message;
        toast.style.cssText = `
            position:absolute; bottom:20px; left:50%; transform:translateX(-50%);
            background:${type === 'error' ? 'rgba(240,69,69,0.9)' : 'rgba(54,212,116,0.9)'};
            color:#fff; padding:8px 18px; border-radius:50px; font-size:12px;
            font-weight:600; z-index:10; white-space:nowrap;
            box-shadow:0 4px 16px rgba(0,0,0,0.4);
            animation:fadeIn 0.2s ease;`;
        document.getElementById('authSection')?.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function showToast(messageOrOpts, typeArg) {
        const opts = (messageOrOpts && typeof messageOrOpts === 'object' && !Array.isArray(messageOrOpts))
            ? messageOrOpts
            : { message: String(messageOrOpts ?? ''), type: typeArg };
        const type = opts.type === 'success' ? 'success' : 'error';
        const duration = Math.max(1500, Math.min(opts.duration || 4000, 10000));



        let title = (opts.title || '').trim();
        let body  = (opts.body  || '').trim();
        if (!title && !body) {
            const raw = String(opts.message || '').trim();
            const m = raw.match(/^([^.!?]{2,40}[.!?])\s+(.{4,})$/);
            if (m) { title = m[1].trim(); body = m[2].trim(); }
            else   { title = raw; }
        }


        document.getElementById('atGenericToast')?.remove();

        const toast = document.createElement('div');
        toast.id = 'atGenericToast';
        toast.className = `at-toast at-toast--${type}`;
        if (typeof opts.onClick === 'function') {
            toast.classList.add('at-toast--clickable');
        }
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.style.setProperty('--at-toast-duration', `${duration}ms`);



        const iconMarkup = type === 'success'
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
               </svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
               </svg>`;

        toast.innerHTML = `
            <span class="at-toast-icon" aria-hidden="true">${iconMarkup}</span>
            <div class="at-toast-text">
                <span class="at-toast-title"></span>
                ${body ? '<span class="at-toast-body"></span>' : ''}
            </div>
            <button type="button" class="at-toast-close" aria-label="Dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" aria-hidden="true">
                     <line x1="18" y1="6" x2="6" y2="18"/>
                     <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <span class="at-toast-progress" aria-hidden="true"></span>
        `;

        toast.querySelector('.at-toast-title').textContent = title;
        if (body) toast.querySelector('.at-toast-body').textContent = body;

        const dismiss = () => {
            if (toast._dismissed) return;
            toast._dismissed = true;
            toast.classList.add('at-toast--leaving');
            setTimeout(() => { try { toast.remove(); } catch {             } }, 180);
        };
        
        toast.querySelector('.at-toast-close').addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss();
        });

        if (typeof opts.onClick === 'function') {
            toast.addEventListener('click', (e) => {
                if (e.target.closest('.at-toast-close')) return;
                dismiss();
                opts.onClick();
            });
        }

        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('at-toast--visible'));

        const timerId = setTimeout(dismiss, duration);

        toast.addEventListener('mouseenter', () => {
            clearTimeout(timerId);
            toast.classList.add('at-toast--paused');
        });
        toast.addEventListener('mouseleave', () => {
            toast.classList.remove('at-toast--paused');

            setTimeout(dismiss, 1500);
        });
    }

    AT.showToast = showToast;
    AT.showAuthToast = showAuthToast;
})();
