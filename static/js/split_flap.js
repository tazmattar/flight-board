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
     * If the full journey is longer than MAX_STEPS, subsample it so the
     * animation never drags on.
     */
    function buildSequence(fromCh, toCh) {
        const f = charIndex(fromCh);
        const t = charIndex(toCh);
        if (f === t) return [];

        const full = [];
        let i = f;
        do {
            i = (i + 1) % CHAR_SET.length;
            full.push(CHAR_SET[i]);
        } while (i !== t && full.length < CHAR_SET.length);

        if (full.length <= MAX_STEPS) return full;

        // Subsample — always land on the target character
        const step = Math.ceil(full.length / MAX_STEPS);
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

        spans.forEach((span, i) => {
            const seq = buildSequence(oldPad[i] ?? ' ', text[i] ?? ' ');
            if (seq.length === 0) return;
            setTimeout(() => flipSpan(span, seq, 0), i * STAGGER_MS);
        });
    }

    return { animateContainer };

})();

window.SplitFlap = SplitFlap;
