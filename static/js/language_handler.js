// Language Management System
// Automatically updates footer text based on airport country

let translations = {};

// Load translations and country mappings on page load
async function loadTranslations() {
    try {
        const response = await fetch('/api/translations');
        translations = await response.json();
        console.log('Translations loaded:', Object.keys(translations));
        return true;
    } catch (error) {
        console.error('Failed to load translations:', error);
        // Fallback to English
        translations = {
            'en': {
                'arrivals': 'Arrivals',
                'departures': 'Departures',
                'gates': 'Gates',
                'security': 'Estimated waiting time<br>at security',
                'bilingual': false
            }
        };
        return false;
    }
}

// Country CODE to language code mapping
const COUNTRY_CODE_TO_LANGUAGE = {
    // English-speaking
    'US': 'en', 'GB': 'en', 'CA': 'en', 'AU': 'en', 'NZ': 'en',
    'IE': 'en', 'ZA': 'en', 'PH': 'en', 'SG': 'en', 'HK': 'en',
    
    // German-speaking
    'CH': 'de', 'DE': 'de', 'AT': 'de',
    
    // French-speaking
    'FR': 'fr', 'BE': 'fr',
    
    // Spanish-speaking
    'ES': 'es', 'MX': 'es', 'AR': 'es', 'CO': 'es', 
    'CL': 'es', 'PE': 'es', 'VE': 'es',
    
    // Other European
    'IT': 'it', 'PT': 'pt', 'BR': 'pt', 'NL': 'nl','SE': 'sv',
    
    // Asian
    'JP': 'ja', 'CN': 'zh',
};

// Country NAME to language code mapping (fallback)
const COUNTRY_TO_LANGUAGE = {
    // English-speaking
    'United States': 'en',
    'United Kingdom': 'en',
    'Canada': 'en',
    'Australia': 'en',
    'New Zealand': 'en',
    'Ireland': 'en',
    'South Africa': 'en',
    'Philippines': 'en',
    'Singapore': 'en',
    'Hong Kong': 'en',
    
    // German-speaking
    'Switzerland': 'de',
    'Germany': 'de',
    'Austria': 'de',
    
    // French-speaking
    'France': 'fr',
    'Belgium': 'fr',
    
    // Spanish-speaking
    'Spain': 'es',
    'Mexico': 'es',
    'Argentina': 'es',
    'Colombia': 'es',
    'Chile': 'es',
    'Peru': 'es',
    'Venezuela': 'es',
    
    // Other European
    'Italy': 'it',
    'Portugal': 'pt',
    'Brazil': 'pt',
    'Netherlands': 'nl',
    'Sweden': 'sv',    
    // Asian
    'Japan': 'ja',
    'China': 'zh',
};

function getLanguageForCountry(country) {
    // First try country code (2 letters like 'CH', 'GB')
    if (country && country.length === 2) {
        const lang = COUNTRY_CODE_TO_LANGUAGE[country.toUpperCase()];
        if (lang) return lang;
    }
    // Then try full country name
    return COUNTRY_TO_LANGUAGE[country] || 'en';
}

// Override the updateFooterText function globally
// This replaces the fallback version in app.js
window.updateFooterText = function(airportCode, country) {
    console.log('[Language Handler] Called with:', { airportCode, country, translationsLoaded: Object.keys(translations).length > 0 }); // DEBUG
    
    // Wait for translations to load
    if (Object.keys(translations).length === 0) {
        console.warn('[Language Handler] Translations not loaded yet, using fallback');
        // Call again after a short delay
        setTimeout(() => window.updateFooterText(airportCode, country), 100);
        return;
    }
    
    // If no country provided yet, use fallback based on airport code
    if (!country) {
        console.log('[Language Handler] No country data yet for', airportCode, '- using fallback');
        // Fallback for hardcoded airports until data arrives
        const fallbackCountries = {
            'LSZH': 'Switzerland',
            'LSGG': 'Switzerland',
            'LFSB': 'France',
            'EGLL': 'United Kingdom',
            'EGKK': 'United Kingdom',
            'KJFK': 'United States'
        };
        country = fallbackCountries[airportCode] || 'United Kingdom';
    }
    
    // Determine language based on country
    const languageCode = getLanguageForCountry(country);
    const translation = translations[languageCode] || translations['en'];
    
    console.log(`[Language Handler] Airport: ${airportCode}, Country: ${country}, Language: ${languageCode}, Bilingual: ${translation.bilingual}`);

    // Expose current language for theme-specific UI behavior
    window.currentLanguageCode = languageCode;
    document.dispatchEvent(new CustomEvent('language-change', { detail: { languageCode } }));
    
    if (translation.bilingual) {
        // Bilingual display: Local language with English subtitle
        console.log('[Language Handler] Applying BILINGUAL display');
        document.getElementById('gateLabel').textContent = translation.gates;
        document.getElementById('arrivalsLabel1').textContent = translation.arrivals;
        document.getElementById('arrivalsLabel2').style.display = 'block';
        document.getElementById('arrivalsLabel2').textContent = translation.arrivals_sub;
        document.getElementById('departuresLabel1').textContent = translation.departures;
        document.getElementById('departuresLabel2').style.display = 'block';
        document.getElementById('departuresLabel2').textContent = translation.departures_sub;
        document.getElementById('securityLabel').innerHTML = translation.security;
    } else {
        // English-only display
        console.log('[Language Handler] Applying ENGLISH-ONLY display');
        document.getElementById('gateLabel').textContent = translation.gates;
        document.getElementById('arrivalsLabel1').textContent = translation.arrivals;
        document.getElementById('arrivalsLabel2').style.display = 'none';
        document.getElementById('departuresLabel1').textContent = translation.departures;
        document.getElementById('departuresLabel2').style.display = 'none';
        document.getElementById('securityLabel').innerHTML = translation.security;
    }
}

// Initialize translations when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Language Handler] Initializing...');
    loadTranslations().then(() => {
        console.log('[Language Handler] Translations ready, override active');
    });
});
