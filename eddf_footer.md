```markdown
# EDDF Custom Footer Implementation Guide

This guide explains how to add the custom Terminal 1 and 2 indicators to the footer specifically for Frankfurt (EDDF) without cluttering the UI or affecting other airport themes.

## Overview of Changes
1. **HTML**: Add the terminal UI structure (hidden by default).
2. **Global CSS**: Ensure the new UI remains hidden for all non-EDDF airports.
3. **EDDF CSS**: Display and style the terminal icons, and hide the default "Gates" icon.
4. **JavaScript**: Relocate the country flags to the left side of the footer only when EDDF is active to save center space.

---

### 1. Update `templates/index.html`

Locate the `<div class="footer-group center-left">` (around line 96) and add the new `eddf-terminals` block right below the `gate-icon-box`:

```html
    <div class="footer-group center-left">
        <span class="material-icons huge-arrow">arrow_upward</span>
        <div class="gate-icon-box">
            <span class="material-icons">flight_takeoff</span>
            <span id="gateLabel">Gates</span>
        </div>
        
        <div class="eddf-terminals">
            <div class="eddf-term">
                <span class="term-num">1</span>
                <span class="term-letters">A B C Z</span>
            </div>
            <div class="eddf-term">
                <span class="term-num">2</span>
                <span class="term-letters">D E</span>
            </div>
        </div>

        <div id="flagContainer" class="country-flags"></div>
    </div>

```

---

### 2. Update `static/css/style.css`

Add this to the very bottom of your main stylesheet to ensure the new element stays hidden globally:

```css
/* Base state for EDDF terminals - Hidden globally */
.eddf-terminals {
    display: none;
}

```

---

### 3. Update `static/css/themes/eddf.css`

Add this block to the bottom of the EDDF theme file. This hides the normal gate box, reveals the terminal text, styles it to match the Frankfurt branding, and adds formatting for the relocated flags:

```css
/* --- FOOTER OVERRIDES --- */
/* Hide the standard gate box */
body.theme-eddf .gate-icon-box {
    display: none !important;
}

/* Show the custom EDDF terminal indicators */
body.theme-eddf .eddf-terminals {
    display: flex;
    gap: 15px;
    align-items: center;
    border: 2px solid #ffffff;
    padding: 6px 15px;
    border-radius: 6px;
    background-color: rgba(0, 0, 0, 0.15); /* Subtle dark backing */
}

body.theme-eddf .eddf-term {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* White box with blue numbers for the Terminal icons */
body.theme-eddf .term-num {
    background-color: #ffffff;
    color: var(--eddf-blue);
    font-family: var(--font-ui);
    font-weight: 900;
    font-size: 20px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    line-height: 1;
}

body.theme-eddf .term-letters {
    color: #ffffff;
    font-family: var(--font-ui);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 4px;
}

/* Subtle divider between T1 and T2 */
body.theme-eddf .eddf-term:first-child::after {
    content: '';
    display: block;
    width: 2px;
    height: 24px;
    background-color: rgba(255, 255, 255, 0.3);
    margin-left: 5px;
}

/* Pull the arrow slightly closer to save space */
body.theme-eddf .huge-arrow {
    margin-right: -5px;
}

/* Format the flags that we are moving to the left group via JS */
body.theme-eddf .footer-group.left #flagContainer {
    margin-left: 10px;
    border-left: 1px solid rgba(255, 255, 255, 0.2);
    padding-left: 15px;
}

```

---

### 4. Update `static/js/app.js`

Find the `updateTheme(airportCode)` function (around line 348). Update the bottom of that function to dynamically move the flags to the left side *only* when viewing Frankfurt, preserving space in the center:

```javascript
        // Update flags (works for both configured and dynamic airports)
        updateFlags(airportCode);
        
        // Move flags for EDDF to prevent footer clutter
        const flagContainer = document.getElementById('flagContainer');
        const footerLeft = document.querySelector('.footer-group.left');
        const footerCenterLeft = document.querySelector('.footer-group.center-left');
        
        if (airportCode === 'EDDF') {
            if (flagContainer && footerLeft && flagContainer.parentElement !== footerLeft) {
                footerLeft.appendChild(flagContainer);
            }
        } else {
            // Revert flags to the center-left group for all other airports
            if (flagContainer && footerCenterLeft && flagContainer.parentElement !== footerCenterLeft) {
                footerCenterLeft.appendChild(flagContainer);
            }
        }

        syncAirportNameCycle();
        applyDestinationNameMode();
    }

```

```

```
