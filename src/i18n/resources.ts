/**
 * Bundled translation resources: one JSON file per namespace and language. Each area owns its
 * namespace files (src/i18n/locales/{en,es}/<namespace>.json); this module only wires them up.
 * Adding a namespace = add it to I18N_NAMESPACE_LIST (core/contracts) + both JSON files + here.
 * M12: also add it to locales/{pt,fr,de} (and here), or to I18N_EN_ES_ONLY_NAMESPACES, whose
 * namespaces exist only in en and es and fall back to English for pt, fr and de.
 */
import type { I18nEnEsOnlyNamespace, I18nNamespace } from '../core/contracts';
import type { AppLanguage, Language } from '../core/types';
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
import enLanding from './locales/en/landing.json';
import enLegal from './locales/en/legal.json';
import enMeetings from './locales/en/meetings.json';
import enNavigation from './locales/en/navigation.json';
import enNotes from './locales/en/notes.json';
import enTasks from './locales/en/tasks.json';
import enOnboarding from './locales/en/onboarding.json';
import enPricing from './locales/en/pricing.json';
import enSettings from './locales/en/settings.json';
import enShell from './locales/en/shell.json';
import enWhatsapp from './locales/en/whatsapp.json';
import enMatters from './locales/en/matters.json';
import enWidget from './locales/en/widget.json';
import enSummaries from './locales/en/summaries.json';
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
import esLanding from './locales/es/landing.json';
import esLegal from './locales/es/legal.json';
import esMeetings from './locales/es/meetings.json';
import esNavigation from './locales/es/navigation.json';
import esNotes from './locales/es/notes.json';
import esTasks from './locales/es/tasks.json';
import esOnboarding from './locales/es/onboarding.json';
import esPricing from './locales/es/pricing.json';
import esSettings from './locales/es/settings.json';
import esShell from './locales/es/shell.json';
import esWhatsapp from './locales/es/whatsapp.json';
import esMatters from './locales/es/matters.json';
import esWidget from './locales/es/widget.json';
import esSummaries from './locales/es/summaries.json';
import ptAi from './locales/pt/ai.json';
import ptAlerts from './locales/pt/alerts.json';
import ptAttachments from './locales/pt/attachments.json';
import ptAuth from './locales/pt/auth.json';
import ptCalendar from './locales/pt/calendar.json';
import ptCalendarView from './locales/pt/calendarView.json';
import ptCommon from './locales/pt/common.json';
import ptCreate from './locales/pt/create.json';
import ptData from './locales/pt/data.json';
import ptHome from './locales/pt/home.json';
import ptInsights from './locales/pt/insights.json';
import ptLanding from './locales/pt/landing.json';
import ptLegal from './locales/pt/legal.json';
import ptMeetings from './locales/pt/meetings.json';
import ptNavigation from './locales/pt/navigation.json';
import ptNotes from './locales/pt/notes.json';
import ptTasks from './locales/pt/tasks.json';
import ptOnboarding from './locales/pt/onboarding.json';
import ptPricing from './locales/pt/pricing.json';
import ptSettings from './locales/pt/settings.json';
import ptShell from './locales/pt/shell.json';
import ptWhatsapp from './locales/pt/whatsapp.json';
import ptWidget from './locales/pt/widget.json';
import ptSummaries from './locales/pt/summaries.json';
import frAi from './locales/fr/ai.json';
import frAlerts from './locales/fr/alerts.json';
import frAttachments from './locales/fr/attachments.json';
import frAuth from './locales/fr/auth.json';
import frCalendar from './locales/fr/calendar.json';
import frCalendarView from './locales/fr/calendarView.json';
import frCommon from './locales/fr/common.json';
import frCreate from './locales/fr/create.json';
import frData from './locales/fr/data.json';
import frHome from './locales/fr/home.json';
import frInsights from './locales/fr/insights.json';
import frLanding from './locales/fr/landing.json';
import frLegal from './locales/fr/legal.json';
import frMeetings from './locales/fr/meetings.json';
import frNavigation from './locales/fr/navigation.json';
import frNotes from './locales/fr/notes.json';
import frTasks from './locales/fr/tasks.json';
import frOnboarding from './locales/fr/onboarding.json';
import frPricing from './locales/fr/pricing.json';
import frSettings from './locales/fr/settings.json';
import frShell from './locales/fr/shell.json';
import frWhatsapp from './locales/fr/whatsapp.json';
import frWidget from './locales/fr/widget.json';
import frSummaries from './locales/fr/summaries.json';
import deAi from './locales/de/ai.json';
import deAlerts from './locales/de/alerts.json';
import deAttachments from './locales/de/attachments.json';
import deAuth from './locales/de/auth.json';
import deCalendar from './locales/de/calendar.json';
import deCalendarView from './locales/de/calendarView.json';
import deCommon from './locales/de/common.json';
import deCreate from './locales/de/create.json';
import deData from './locales/de/data.json';
import deHome from './locales/de/home.json';
import deInsights from './locales/de/insights.json';
import deLanding from './locales/de/landing.json';
import deLegal from './locales/de/legal.json';
import deMeetings from './locales/de/meetings.json';
import deNavigation from './locales/de/navigation.json';
import deNotes from './locales/de/notes.json';
import deTasks from './locales/de/tasks.json';
import deOnboarding from './locales/de/onboarding.json';
import dePricing from './locales/de/pricing.json';
import deSettings from './locales/de/settings.json';
import deShell from './locales/de/shell.json';
import deWhatsapp from './locales/de/whatsapp.json';
import deWidget from './locales/de/widget.json';
import deSummaries from './locales/de/summaries.json';

/** A namespace's JSON tree (nested objects, strings and string arrays). */
export type TranslationTree = { readonly [key: string]: unknown };

/** M12: en and es carry every namespace; pt, fr and de may leave out the en/es-only ones. */
export type AppResources = Readonly<Record<Language, Readonly<Record<I18nNamespace, TranslationTree>>>> &
  Readonly<
    Record<
      Exclude<AppLanguage, Language>,
      Readonly<Record<Exclude<I18nNamespace, I18nEnEsOnlyNamespace>, TranslationTree> &
        Partial<Record<I18nEnEsOnlyNamespace, TranslationTree>>>
    >
  >;

export const RESOURCES: AppResources = {
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
    tasks: enTasks,
    attachments: enAttachments,
    home: enHome,
    insights: enInsights,
    shell: enShell,
    landing: enLanding,
    legal: enLegal,
    pricing: enPricing,
    widget: enWidget,
    whatsapp: enWhatsapp,
    summaries: enSummaries,
    matters: enMatters,
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
    tasks: esTasks,
    attachments: esAttachments,
    home: esHome,
    insights: esInsights,
    shell: esShell,
    landing: esLanding,
    legal: esLegal,
    pricing: esPricing,
    widget: esWidget,
    whatsapp: esWhatsapp,
    summaries: esSummaries,
    matters: esMatters,
  },
  // M12: pt/fr/de have no en/es-only namespaces (matters); those fall back to English.
  pt: {
    common: ptCommon,
    navigation: ptNavigation,
    onboarding: ptOnboarding,
    data: ptData,
    auth: ptAuth,
    calendar: ptCalendar,
    alerts: ptAlerts,
    ai: ptAi,
    settings: ptSettings,
    meetings: ptMeetings,
    calendarView: ptCalendarView,
    create: ptCreate,
    notes: ptNotes,
    tasks: ptTasks,
    attachments: ptAttachments,
    home: ptHome,
    insights: ptInsights,
    shell: ptShell,
    landing: ptLanding,
    legal: ptLegal,
    pricing: ptPricing,
    widget: ptWidget,
    whatsapp: ptWhatsapp,
    summaries: ptSummaries,
  },
  // M12: pt/fr/de have no en/es-only namespaces (matters); those fall back to English.
  fr: {
    common: frCommon,
    navigation: frNavigation,
    onboarding: frOnboarding,
    data: frData,
    auth: frAuth,
    calendar: frCalendar,
    alerts: frAlerts,
    ai: frAi,
    settings: frSettings,
    meetings: frMeetings,
    calendarView: frCalendarView,
    create: frCreate,
    notes: frNotes,
    tasks: frTasks,
    attachments: frAttachments,
    home: frHome,
    insights: frInsights,
    shell: frShell,
    landing: frLanding,
    legal: frLegal,
    pricing: frPricing,
    widget: frWidget,
    whatsapp: frWhatsapp,
    summaries: frSummaries,
  },
  // M12: pt/fr/de have no en/es-only namespaces (matters); those fall back to English.
  de: {
    common: deCommon,
    navigation: deNavigation,
    onboarding: deOnboarding,
    data: deData,
    auth: deAuth,
    calendar: deCalendar,
    alerts: deAlerts,
    ai: deAi,
    settings: deSettings,
    meetings: deMeetings,
    calendarView: deCalendarView,
    create: deCreate,
    notes: deNotes,
    tasks: deTasks,
    attachments: deAttachments,
    home: deHome,
    insights: deInsights,
    shell: deShell,
    landing: deLanding,
    legal: deLegal,
    pricing: dePricing,
    widget: deWidget,
    whatsapp: deWhatsapp,
    summaries: deSummaries,
  },
};
