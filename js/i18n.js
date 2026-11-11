/**
 * i18n Internationalization helper for Eagle Plugin
 */
const I18N = {
  currentLocale: 'zh_CN',
  localesData: {},

  supportedLocales: [
    { code: 'zh_CN', label: '简体中文' },
    { code: 'zh_TW', label: '繁體中文' },
    { code: 'en', label: 'English' },
    { code: 'ja_JP', label: '日本語' }
  ],

  async init() {
    // 1. Detect language from Eagle if available
    let initialLocale = 'zh_CN';
    if (typeof eagle !== 'undefined' && eagle.app && eagle.app.locale) {
      initialLocale = this.normalizeLocale(eagle.app.locale);
    } else {
      const navLang = navigator.language.replace('-', '_');
      initialLocale = this.normalizeLocale(navLang);
    }
    this.currentLocale = initialLocale;

    // 2. Preload language json files
    await Promise.all(
      this.supportedLocales.map(async (item) => {
        try {
          const resp = await fetch(`_locales/${item.code}.json`);
          if (resp.ok) {
            this.localesData[item.code] = await resp.json();
          }
        } catch (e) {
          console.warn(`Failed to load locale file for ${item.code}`, e);
        }
      })
    );

    this.applyTranslations();
  },

  normalizeLocale(locale) {
    if (!locale) return 'zh_CN';
    const l = locale.toLowerCase();
    if (l.includes('tw') || l.includes('hk') || l.includes('hant')) return 'zh_TW';
    if (l.includes('cn') || l.includes('hans') || l.startsWith('zh')) return 'zh_CN';
    if (l.startsWith('ja')) return 'ja_JP';
    if (l.startsWith('en')) return 'en';
    return 'en';
  },

  setLocale(locale) {
    const valid = this.supportedLocales.find(l => l.code === locale);
    if (valid) {
      this.currentLocale = locale;
      this.applyTranslations();
    }
  },

  t(path, vars = {}) {
    // If Eagle's i18next global is active and matches current locale, we can try it
    if (typeof i18next !== 'undefined' && typeof i18next.t === 'function') {
      const val = i18next.t(path, vars);
      if (val && val !== path) return val;
    }

    const dict = this.localesData[this.currentLocale] || this.localesData['zh_CN'] || {};
    const parts = path.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) {
        cur = cur[p];
      } else {
        cur = null;
        break;
      }
    }

    let text = typeof cur === 'string' ? cur : path;
    // Replace {{key}}
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v);
    }
    return text;
  },

  applyTranslations() {
    // Translate textContent
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const translation = this.t(key);
      if (translation && translation !== key) {
        el.textContent = translation;
      }
    });

    // Translate placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', this.t(key));
    });

    // Translate title
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      el.setAttribute('title', this.t(key));
    });

    // Dispatch event to trigger preview or UI redraw if needed
    window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale: this.currentLocale } }));
  }
};
