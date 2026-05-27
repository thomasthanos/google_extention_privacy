


(function () {
    'use strict';


    const _dialogState = new WeakMap();

    function focusableIn(root) {
        if (!root) return [];
        return Array.from(root.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
    }

    function open(overlay, opts = {}) {
        if (!overlay) return;
        const restoreTo = document.activeElement;
        overlay.classList.add('visible');
        overlay.setAttribute('aria-hidden', 'false');
        const trapHandler = (e) => {
            if (e.key === 'Escape' && opts.dismissOnEscape !== false) {
                e.preventDefault();
                close(overlay);
                opts.onCancel?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const focusables = focusableIn(overlay);
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        overlay.addEventListener('keydown', trapHandler);
        _dialogState.set(overlay, { restoreTo, trapHandler });

        requestAnimationFrame(() => {
            const focusables = focusableIn(overlay);
            (opts.initialFocus || focusables[0])?.focus();
        });
    }

    function close(overlay) {
        if (!overlay) return;
        const state = _dialogState.get(overlay);
        if (state) {
            overlay.removeEventListener('keydown', state.trapHandler);
            _dialogState.delete(overlay);
            try { state.restoreTo?.focus?.(); } catch {                                     }
        }
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }


    function inlineConfirm({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
        return new Promise((resolve) => {

            document.querySelectorAll('.at-confirm-toast').forEach(n => n.remove());

            const el = document.createElement('div');
            el.className = 'at-confirm-toast' + (danger ? ' at-confirm-toast--danger' : '');
            el.setAttribute('role', 'alertdialog');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML = `
                <div class="at-confirm-text">
                    ${title ? `<div class="at-confirm-title"></div>` : ''}
                    ${body  ? `<div class="at-confirm-body"></div>`  : ''}
                </div>
                <div class="at-confirm-actions">
                    <button type="button" class="at-confirm-cancel"></button>
                    <button type="button" class="at-confirm-ok"></button>
                </div>
            `;

            if (title) el.querySelector('.at-confirm-title').textContent = title;
            if (body)  el.querySelector('.at-confirm-body').textContent = body;
            el.querySelector('.at-confirm-cancel').textContent = cancelLabel;
            el.querySelector('.at-confirm-ok').textContent = confirmLabel;

            const finish = (value) => {
                el.classList.add('at-confirm-toast--leaving');
                setTimeout(() => { try { el.remove(); } catch {             } }, 180);
                clearTimeout(timeoutId);
                document.removeEventListener('keydown', onKey, true);
                resolve(value);
            };
            const autoDismissMs = danger ? 60000 : 8000;
            const timeoutId = setTimeout(() => finish(false), autoDismissMs);

            el.querySelector('.at-confirm-ok').addEventListener('click', () => finish(true));
            el.querySelector('.at-confirm-cancel').addEventListener('click', () => finish(false));

            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('at-confirm-toast--visible'));

            setTimeout(() => el.querySelector('.at-confirm-ok')?.focus(), 50);
            const onKey = (e) => {
                if (e.key === 'Escape') finish(false);
                else if (e.key === 'Enter') finish(true);
            };
            document.addEventListener('keydown', onKey, true);
        });
    }

    window.AnimeTracker = window.AnimeTracker || {};
    window.AnimeTracker.Dialogs = { open, close, inlineConfirm };
})();
