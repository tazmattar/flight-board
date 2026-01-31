# Investigation Notes

## Open Issue: Header Widget Spacing on RJTT and EGKK

**Status:** UNRESOLVED - Pending deeper investigation  
**Date Reported:** 2026-01-31  
**Affected Airports:** RJTT (Tokyo Haneda), EGKK (London Gatwick)  
**Working Airports:** KJFK, LFSB, EGLC, EGSS, LSGG, LSZH

### Problem Description

The header widgets (ATC radar icon, weather icon + temperature, and clock) are spreading apart with large gaps between them on RJTT and EGKK airports only. All other airports display the widgets correctly grouped together and right-aligned.

### Symptoms

- ✅ Widgets ARE on the same horizontal line (no wrapping)
- ✅ Widgets ARE right-aligned in the header
- ❌ Widgets HAVE huge gaps between them (~100-300px gaps)
- ❌ Only affects RJTT and EGKK themes
- ❌ Affects all browsers (Firefox, Chromium, Chrome, Safari, Edge)

### Root Cause Analysis

**Hypothesis:** CSS specificity conflict between `style.css` and theme files

However, investigation revealed:
- No layout-related CSS rules in RJTT or EGKK theme files that would cause spreading
- Both theme files only contain color/styling overrides
- Adding explicit rules with `!important` flags to theme files did NOT resolve the issue

**Current Theory:** The issue may be related to:
1. How the flexbox container renders within the specific theme's background/styling
2. A rendering order issue with how theme CSS is applied
3. Some inherited property from the theme that affects flex child distribution
4. Browser-specific rendering of flex containers in certain color contexts

### Fixes Attempted (Commits)

| Commit | Change | Result |
|--------|--------|--------|
| 51eaf3f | Initial header layout refactor from grid to flexbox | Partial fix |
| 8a8c1cf | Added flex sizing constraints | No change on RJTT/EGKK |
| 31dfcc6 | Improved flex-basis and flex-direction | No change |
| 7034c0a | Simplified to inline-flex | No change |
| 27b3188 | Added justify-content: flex-start | Partial fix (grouped widgets but wrong alignment) |
| dc7784d | Added width: fit-content to containers | No change |
| 256e7ba | Changed grid to minmax(max-content, auto) | No change |
| 267ddfe | Switched header from grid to flexbox | Fixed all except RJTT/EGKK |
| ad26263 | Added margin-left: auto for right-alignment | Widgets now right-aligned but still spread on RJTT/EGKK |
| 23145d7 | Added explicit rules to theme files with !important | **No change** |

### CSS Structure

**Base CSS (style.css):**
```css
.fids-header {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 30px;
}

.airport-selector {
    flex-shrink: 1;
}

.header-right-group {
    display: inline-flex;
    gap: 20px;
    flex-wrap: nowrap;
    white-space: nowrap;
    flex-shrink: 0;
    width: fit-content;
    margin-left: auto;
}

.header-widgets {
    display: inline-flex;
    gap: 25px;
    flex-wrap: nowrap;
    white-space: nowrap;
    width: fit-content;
}

.clock-container {
    display: inline-flex;
    gap: 0;
    white-space: nowrap;
    width: fit-content;
}
```

**Theme Overrides (RJTT/EGKK):**
- RJTT: Only color, background, border, and flight-table styling
- EGKK: Only color, background, border, and flight-table styling
- NO header layout rules

### Questions for Further Investigation

1. Is there a `justify-content` or `justify-items` property being inherited from somewhere?
2. Is the flex container's width actually correct, or is it being stretched?
3. Does the issue occur when switching to RJTT WHILE viewing the page, or only on initial load?
4. Are there any pseudo-elements or generated content affecting the layout?
5. Could this be a browser rendering issue with specific color combinations (blue/white backgrounds)?

### Next Steps (When Revisiting)

1. **Use Browser DevTools:**
   - Inspect `.header-right-group` and check ALL computed properties
   - Check if `display: flex` is actually being applied
   - Verify `gap`, `flex-wrap`, `white-space`, `width`, and `margin-left` values
   - Check if there are any pseudo-elements being rendered

2. **Test CSS Overrides:**
   - Try `display: flex` instead of `inline-flex`
   - Try `width: auto` instead of `width: fit-content`
   - Try removing `flex-wrap: nowrap` entirely
   - Test if removing `white-space: nowrap` helps

3. **Check HTML Structure:**
   - Verify the HTML structure is identical for all airports
   - Check if there are any extra spaces or text nodes affecting flex layout

4. **Isolation Testing:**
   - Create a minimal test case with just the header on RJTT theme
   - Gradually add back CSS to find the breaking point

5. **Alternative Solutions:**
   - Consider using CSS Grid with `auto-fit` or `auto-fill`
   - Try using `gap` with explicit grid positioning
   - Consider JavaScript-based width constraint

### Related Files

- `static/css/style.css` - Main stylesheet
- `static/css/themes/rjtt.css` - RJTT theme
- `static/css/themes/egkk.css` - EGKK theme
- `templates/index.html` - HTML structure

### Timeline

- Started: 2026-01-31
- Status: Unresolved, pending fresh investigation
- Priority: Medium (7/9 airports work correctly)
