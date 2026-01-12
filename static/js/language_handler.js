// Language Management System
// Automatically updates footer text based on airport country

let translations = {};
let countryLanguageMap = {};

// Load translations and country mappings on page load
async function loadTranslations() {
    try {
        const response = await fetch('/api/translations');
        translations = await response.json();
        console.log('Translations loaded:', Object.keys(translations));
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
    }
}

// Country to language code mapping
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
    
    // Asian
    'Japan': 'ja',
    'China': 'zh',
};

function getLanguageForCountry(country) {
    return COUNTRY_TO_LANGUAGE[country] || 'en';
}

function updateFooterText(airportCode, country) {
    // Determine language based on country
    const languageCode = getLanguageForCountry(country);
    const translation = translations[languageCode] || translations['en'];
    
    console.log(`Airport: ${airportCode}, Country: ${country}, Language: ${languageCode}`);
    
    if (translation.bilingual) {
        // Bilingual display: Local language with English subtitle
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
    loadTranslations();
});