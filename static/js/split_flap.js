/**
 * split_flap.js — Solari split-flap display animation
 *
 * Activates only when body.theme-eddf is present.
 * Each character position cycles through intermediate glyphs
 * before settling on the target, mimicking a real Solari board.
 */
const SplitFlap = (() => {

    // Classic Solari glyph order: blank → A-Z → 0-9 → punctuation
    const CHAR_SET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.:/ ';

    const FLIP_MS       = 75;   // Duration of one individual flap (ms)
    const INTER_MS      = 10;   // Gap between consecutive flaps on the same cell
    const STAGGER_MS    = 30;   // Delay offset per character position (wave effect)
    const MAX_STEPS     = 5;    // Cap on intermediate chars before settling

    // ── lite mode ─────────────────────────────────────────────────────────────
    // Activated via ?lite=1 URL param (persisted to localStorage).
    // Uses a simple per-cell opacity fade instead of character animation —
    // keeps weak GPUs (e.g. Raspberry Pi 4B) smooth without touching the
    // desktop experience. Clear with ?lite=0.

    const LITE_KEY = 'sf_lite';

    (function initLiteMode() {
        const p = new URLSearchParams(location.search).get('lite');
        if      (p === '1') localStorage.setItem(LITE_KEY, '1');
        else if (p === '0') localStorage.setItem(LITE_KEY, '0');
        if (isLiteMode()) document.body.classList.add('sf-lite-mode');
    })();

    // Auto-enables on portrait + non-touch pointer (Pi kiosk with mouse/no pointer).
    // Tablets/iPads in portrait have pointer:coarse and get the full animation.
    // ?lite=1 forces lite on (sticky). ?lite=0 forces full on (sticky).
    function isLiteMode() {
        const stored = localStorage.getItem(LITE_KEY);
        if (stored === '1') return true;
        if (stored === '0') return false;
        return window.matchMedia('(orientation: portrait)').matches &&
              !window.matchMedia('(pointer: coarse)').matches;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function isActive() {
        return document.body.classList.contains('theme-eddf');
    }

    function charIndex(ch) {
        const c = String(ch || ' ').toUpperCase();
        const i = CHAR_SET.indexOf(c);
        return i >= 0 ? i : 0;
    }

    /**
     * Build the list of glyphs to cycle through going from `fromCh` → `toCh`.
     * If the full journey is longer than maxSteps, subsample it so the
     * animation never drags on.
     */
    function buildSequence(fromCh, toCh, maxSteps) {
        const f = charIndex(fromCh);
        const t = charIndex(toCh);
        if (f === t) return [];

        const full = [];
        let i = f;
        do {
            i = (i + 1) % CHAR_SET.length;
            full.push(CHAR_SET[i]);
        } while (i !== t && full.length < CHAR_SET.length);

        if (full.length <= maxSteps) return full;

        // Subsample — always land on the target character
        const step = Math.ceil(full.length / maxSteps);
        const reduced = [];
        for (let j = step - 1; j < full.length - 1; j += step) {
            reduced.push(full[j]);
        }
        reduced.push(full[full.length - 1]);
        return reduced;
    }

    // ── per-span flip ─────────────────────────────────────────────────────────

    function flipSpan(span, seq, idx) {
        if (idx >= seq.length) return;
        span.textContent = seq[idx];
        span.classList.add('sf-flapping');
        setTimeout(() => {
            span.classList.remove('sf-flapping');
            if (idx + 1 < seq.length) {
                setTimeout(() => flipSpan(span, seq, idx + 1), INTER_MS);
            }
        }, FLIP_MS);
    }

    // ── DOM helpers ───────────────────────────────────────────────────────────

    /**
     * Ensure the container has exactly `len` .sf-char spans.
     * Rebuilds from scratch only when the count differs, preserving existing
     * text so in-progress animations aren't disturbed unnecessarily.
     */
    function ensureSpans(container, len) {
        const existing = container.querySelectorAll('.sf-char');
        if (existing.length === len) return Array.from(existing);

        const oldText = Array.from(existing).map(s => s.textContent).join('');
        container.innerHTML = '';
        const spans = [];
        for (let i = 0; i < len; i++) {
            const span = document.createElement('span');
            span.className = 'sf-char';
            span.textContent = oldText[i] || ' ';
            container.appendChild(span);
            spans.push(span);
        }
        return spans;
    }

    // ── lite-mode fade ────────────────────────────────────────────────────────

    function animateLite(container, text) {
        let settled = false;
        function finish() {
            if (settled) return;
            settled = true;
            container.textContent = text;
            container.classList.remove('sf-fading');
        }
        container.classList.add('sf-fading');
        container.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 300); // fallback if transitionend never fires
    }

    // ── public API ────────────────────────────────────────────────────────────

    /**
     * Animate `container` to display `newText`.
     *
     * • EDDF theme active  → split-flap character animation
     * • Any other theme    → instant textContent update (cleans up any spans)
     */
    function animateContainer(container, newText) {
        if (!container) return;
        const text = String(newText || '');

        if (!isActive()) {
            // Tear down spans left over from a previous EDDF session
            if (container.querySelector('.sf-char')) {
                container.innerHTML = '';
            }
            container.textContent = text;
            return;
        }

        // Lite mode — single opacity fade per cell, no per-character animation
        if (isLiteMode()) {
            const hasSfSpans = !!container.querySelector('.sf-char');
            const currentText = hasSfSpans
                ? Array.from(container.querySelectorAll('.sf-char')).map(s => s.textContent).join('')
                : container.textContent;
            if (currentText === text) return;
            if (hasSfSpans) container.innerHTML = '';
            if (!currentText.trim()) {
                container.textContent = text; // initial population: instant, no fade
            } else {
                animateLite(container, text);
            }
            return;
        }

        // Read current displayed text from existing spans (if any)
        const existing = Array.from(container.querySelectorAll('.sf-char'));
        const currentText = existing.map(s => s.textContent).join('');

        // Nothing to do
        if (currentText === text && existing.length === text.length) return;

        // Initial population (container was empty) — set text instantly to avoid
        // firing hundreds of simultaneous animations on first data load.
        if (existing.length === 0) {
            const spans = ensureSpans(container, text.length);
            spans.forEach((span, i) => { span.textContent = text[i] ?? ' '; });
            return;
        }

        const spans   = ensureSpans(container, text.length);
        const oldPad  = currentText.padEnd(text.length, ' ');

        // Long strings (destination/origin) get 1 intermediate glyph per character —
        // keeps peak concurrent animations low on weak GPUs (Pi 4B) while still
        // looking like a split-flap. Short strings (status, gate) get full steps.
        const steps = text.length > 9 ? 1 : MAX_STEPS;

        spans.forEach((span, i) => {
            const seq = buildSequence(oldPad[i] ?? ' ', text[i] ?? ' ', steps);
            if (seq.length === 0) return;
            setTimeout(() => flipSpan(span, seq, 0), i * STAGGER_MS);
        });
    }

    function setLiteMode(on) {
        if (on) {
            localStorage.setItem(LITE_KEY, '1');
            document.body.classList.add('sf-lite-mode');
        } else {
            localStorage.removeItem(LITE_KEY);
            document.body.classList.remove('sf-lite-mode');
        }
    }

    return { animateContainer, isLiteMode, setLiteMode };

})();

window.SplitFlap = SplitFlap;
