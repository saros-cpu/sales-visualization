import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh.json';
import ru from './ru.json';

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, ru: { translation: ru } },
  lng: localStorage.getItem('lang') || 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export default i18n;
