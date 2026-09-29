/**
 * Bundled translation resources: one JSON file per namespace and language. Each area owns its
 * namespace files (src/i18n/locales/{en,es}/<namespace>.json); this module only wires them up.
 * Adding a namespace = add it to I18N_NAMESPACE_LIST (core/contracts) + both JSON files + here.
 */
import type { I18nNamespace } from '../core/contracts';
import type { Language } from '../core/types';
import enAi from './locales/en/ai.json';
import enAlerts from './locales/en/alerts.json';
import enAttachments from './locales/en/attachments.json';
import enAuth from './locales/en/auth.json';
import enCalendar from './locales/en/calendar.json';
import enCalendarView from './locales/en/calendarView.json';
import enCommon from './locales/en/common.json';
import enCreate from './locales/en/create.json';
import enData from './locales/en/data.json';
import enHome from './locales/en/home.json';
import enInsights from './locales/en/insights.json';
import enMeetings from './locales/en/meetings.json';
import enNavigation from './locales/en/navigation.json';
import enNotes from './locales/en/notes.json';
import enOnboarding from './locales/en/onboarding.json';
import enSettings from './locales/en/settings.json';
import esAi from './locales/es/ai.json';
import esAlerts from './locales/es/alerts.json';
import esAttachments from './locales/es/attachments.json';
import esAuth from './locales/es/auth.json';
import esCalendar from './locales/es/calendar.json';
import esCalendarView from './locales/es/calendarView.json';
import esCommon from './locales/es/common.json';
import esCreate from './locales/es/create.json';
import esData from './locales/es/data.json';
import esHome from './locales/es/home.json';
import esInsights from './locales/es/insights.json';
import esMeetings from './locales/es/meetings.json';
import esNavigation from './locales/es/navigation.json';
import esNotes from './locales/es/notes.json';
import esOnboarding from './locales/es/onboarding.json';
import esSettings from './locales/es/settings.json';

/** A namespace's JSON tree (nested objects, strings and string arrays). */
export type TranslationTree = { readonly [key: string]: unknown };

export const RESOURCES: Readonly<Record<Language, Readonly<Record<I18nNamespace, TranslationTree>>>> = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    onboarding: enOnboarding,
    data: enData,
    auth: enAuth,
    calendar: enCalendar,
    alerts: enAlerts,
    ai: enAi,
    settings: enSettings,
    meetings: enMeetings,
    calendarView: enCalendarView,
    create: enCreate,
    notes: enNotes,
    attachments: enAttachments,
    home: enHome,
    insights: enInsights,
  },
  es: {
    common: esCommon,
    navigation: esNavigation,
    onboarding: esOnboarding,
    data: esData,
    auth: esAuth,
    calendar: esCalendar,
    alerts: esAlerts,
    ai: esAi,
    settings: esSettings,
    meetings: esMeetings,
    calendarView: esCalendarView,
    create: esCreate,
    notes: esNotes,
    attachments: esAttachments,
    home: esHome,
    insights: esInsights,
  },
};
