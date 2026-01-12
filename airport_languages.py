"""
Airport Language Configuration
Maps countries to their primary languages and provides translations for UI elements
"""

class AirportLanguages:
    """Manages language configurations for airport displays"""
    
    # Map of country codes to their primary language
    COUNTRY_LANGUAGES = {
        # English-speaking countries
        'United States': 'en',
        'United Kingdom': 'en',
        'Canada': 'en',
        'Australia': 'en',
        'New Zealand': 'en',
        'Ireland': 'en',
        'South Africa': 'en',
        
        # German-speaking countries
        'Switzerland': 'de',
        'Germany': 'de',
        'Austria': 'de',
        
        # French-speaking countries
        'France': 'fr',
        'Belgium': 'fr',
        
        # Spanish-speaking countries
        'Spain': 'es',
        'Mexico': 'es',
        'Argentina': 'es',
        'Colombia': 'es',
        'Chile': 'es',
        
        # Other European languages
        'Italy': 'it',
        'Portugal': 'pt',
        'Netherlands': 'nl',
        'Sweden': 'sv',
        'Norway': 'no',
        'Denmark': 'da',
        'Finland': 'fi',
        'Poland': 'pl',
        'Czech Republic': 'cs',
        'Greece': 'el',
        'Turkey': 'tr',
        
        # Asian languages
        'Japan': 'ja',
        'China': 'zh',
        'South Korea': 'ko',
        'Thailand': 'th',
        'Vietnam': 'vi',
        'India': 'hi',
        'Indonesia': 'id',
        'Malaysia': 'ms',
        'Philippines': 'en',  # English is widely used
        'Singapore': 'en',
        'Hong Kong': 'en',
        
        # Middle Eastern languages
        'United Arab Emirates': 'ar',
        'Saudi Arabia': 'ar',
        'Qatar': 'ar',
        'Israel': 'he',
        
        # South American (additional)
        'Brazil': 'pt',
        'Peru': 'es',
        'Venezuela': 'es',
    }
    
    # Translations for UI elements
    TRANSLATIONS = {
        'en': {
            'arrivals': 'Arrivals',
            'departures': 'Departures',
            'gate': 'Gate',
            'gates': 'Gates',
            'security': 'Estimated waiting time<br>at security',
            'bilingual': False  # English-only display
        },
        'de': {
            'arrivals': 'Ankunft',
            'arrivals_sub': 'Arrivals',
            'departures': 'Abflug',
            'departures_sub': 'Departures',
            'gate': 'Flugsteig',
            'gates': 'Gates',
            'security': 'Actual waiting time<br>at security control',
            'bilingual': True
        },
        'fr': {
            'arrivals': 'Arrivées',
            'arrivals_sub': 'Arrivals',
            'departures': 'Départs',
            'departures_sub': 'Departures',
            'gate': 'Porte',
            'gates': 'Gates',
            'security': 'Temps d\'attente estimé<br>au contrôle de sécurité',
            'bilingual': True
        },
        'es': {
            'arrivals': 'Llegadas',
            'arrivals_sub': 'Arrivals',
            'departures': 'Salidas',
            'departures_sub': 'Departures',
            'gate': 'Puerta',
            'gates': 'Gates',
            'security': 'Tiempo de espera estimado<br>en seguridad',
            'bilingual': True
        },
        'it': {
            'arrivals': 'Arrivi',
            'arrivals_sub': 'Arrivals',
            'departures': 'Partenze',
            'departures_sub': 'Departures',
            'gate': 'Uscita',
            'gates': 'Gates',
            'security': 'Tempo di attesa stimato<br>ai controlli di sicurezza',
            'bilingual': True
        },
        'pt': {
            'arrivals': 'Chegadas',
            'arrivals_sub': 'Arrivals',
            'departures': 'Partidas',
            'departures_sub': 'Departures',
            'gate': 'Portão',
            'gates': 'Gates',
            'security': 'Tempo estimado de espera<br>na segurança',
            'bilingual': True
        },
        'nl': {
            'arrivals': 'Aankomst',
            'arrivals_sub': 'Arrivals',
            'departures': 'Vertrek',
            'departures_sub': 'Departures',
            'gate': 'Gate',
            'gates': 'Gates',
            'security': 'Geschatte wachttijd<br>bij de beveiliging',
            'bilingual': True
        },
        'ja': {
            'arrivals': '到着',
            'arrivals_sub': 'Arrivals',
            'departures': '出発',
            'departures_sub': 'Departures',
            'gate': 'ゲート',
            'gates': 'Gates',
            'security': 'セキュリティでの<br>予想待ち時間',
            'bilingual': True
        },
        'zh': {
            'arrivals': '到达',
            'arrivals_sub': 'Arrivals',
            'departures': '出发',
            'departures_sub': 'Departures',
            'gate': '登机口',
            'gates': 'Gates',
            'security': '安检预计<br>等待时间',
            'bilingual': True
        }
    }
    
    @classmethod
    def get_language_for_country(cls, country):
        """
        Get the language code for a given country
        
        Args:
            country: Country name (e.g., 'United Kingdom')
            
        Returns:
            str: Language code (e.g., 'en') or 'en' as default
        """
        return cls.COUNTRY_LANGUAGES.get(country, 'en')
    
    @classmethod
    def get_translations_for_country(cls, country):
        """
        Get UI translations for a given country
        
        Args:
            country: Country name
            
        Returns:
            dict: Translation dictionary
        """
        language = cls.get_language_for_country(country)
        return cls.TRANSLATIONS.get(language, cls.TRANSLATIONS['en'])
    
    @classmethod
    def get_all_translations(cls):
        """
        Get all available translations for client-side use
        
        Returns:
            dict: Complete translation dictionary
        """
        return cls.TRANSLATIONS