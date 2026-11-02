# MeetingGuard AI — Design System "MG Indigo" (v1, authoritative)

This document merges the UI style audit and the design-language spec into the single system the
UI-modernization implementers follow. Tokens live in code at `src/theme/tokens.ts` — **that file
is the source of truth for values**; this document explains intent, per-screen application, and
ownership. If the two disagree, `src/theme/tokens.ts` wins; fix this document.

Scope: **visual refactor only.** Business logic, hooks, navigation params, route names/titles,
i18n keys (adding new ones is fine), test semantics, alert behavior and data flow are untouched.

## 0. Hard rules (apply to every implementer)

- Import design values **only** from `src/theme` (`import { useAppTheme, spacing, radii, typography, componentMetrics } from '../../theme'`).
  No hex/rgba literals outside `src/theme/tokens.ts` — the only exceptions are
  `NotConfiguredScreen.tsx` (renders without providers; fixed colors intentional) and image assets.
- No new runtime dependencies. Styling = `StyleSheet.create` + tokens + react-native-paper 5
  theming. Animations = RN `Animated` only (**no reanimated**). Icons = per-family
  `@expo/vector-icons/<Family>` imports (ESLint blocks the barrel).
- Never change: `testID`s, `accessibilityRole/Label/State/Actions`, `maxFontSizeMultiplier`
  guards (`HEADER_MAX_FONT_SCALE`, `BADGE_MAX_FONT_SCALE`, `PILL_MAX_FONT_SCALE`), existing i18n
  keys, route names/titles, navigation params, `SIDEBAR_ITEMS` routes, FlatList/SectionList
  structures, keyboard avoidance in `ScreenBody`, alert engine behavior (once-handlers,
  auto-snooze, block-back, reduce-motion paths), WhatsApp "coming soon" disabled state.
- Both light AND dark mode, AA contrast (≥4.5:1 text, ≥3:1 graphics). Every token pair in
  `tokens.ts` is pre-validated — use the pairs as documented, don't improvise combinations.
- 360dp-first: gutter 16, no horizontal overflow, touch targets ≥44dp (use `hitSlop` when the
  visual is smaller). Font scaling: never a fixed `height` on a text container — use padding +
  `minHeight`; body text never caps its font scale.
- Parallel implementers do NOT commit; the sequencer commits. Never push. Never touch
  `.env*`, `.firebaserc`, `reference/`, `android/`, `functions/`.

## 1. Direction

Calm, confident, content-first productivity tool. **One brand hue: MG Indigo** (`#4646D3` light /
`#AFB4FF` dark), replacing Paper's stock purple `#6750A4` everywhere. Neutrals are cool slate
(blue-cast, never warm gray). Color is rationed: indigo marks the one primary action, selection,
and one data emphasis per screen; everything else is neutral surface + type hierarchy. Depth comes
from surface steps and hairline borders, not shadows. Semantic red/amber/green/sky carry meaning
only (alerts, sync states, statuses), never decoration. Alert overlays are deliberately
**mode-invariant** (always dark) so a MAX alarm reads identically day or night — the audit flagged
them as "off-theme in light mode"; that is resolved as *intentional*, but they become token-driven
and AA-compliant.

The audit's three design languages (MD3-purple, assistant emerald/slate, calendarSync blue/slate)
collapse into this one language. `src/services/ai/presentation.ts` `AssistantPalette` values and
`src/screens/calendarSync/palette.ts` are replaced by theme tokens (keep exported types/function
signatures where other code imports them; the values come from the theme).

## 2. Color

Exact values: `lightColors` / `darkColors` in `src/theme/tokens.ts`. Summary of roles:

| Role | Light | Dark | Use |
|---|---|---|---|
| primary / onPrimary | `#4646D3` / `#FFFFFF` (6.82:1) | `#AFB4FF` / `#101273` (7.96:1) | The one primary action, FAB, selection, focus, links |
| primaryContainer / on | `#E3E6FC` / `#26268F` | `#34349E` / `#E3E6FC` | Focal card (next meeting), selected day, icon circles |
| secondary(Container) | slate `#44566E` / `#E3E9F1` | `#AEBED4` / `#32415A` | Tonal buttons, selected chips, sidebar active pill |
| tertiary(Container) | teal `#0B7A6E` / `#D3F2F7` | `#3ECFBE` / `#0F515F` | Calendar/sync accents, assistant action icons |
| background / surface | `#F6F8FB` / `#FFFFFF` | `#0C1320` / `#131C2B` | Screen bg / cards, header, sidebar |
| surfaceVariant | `#E7ECF3` | `#26334A` | Inputs at rest, skeletons, icon-circle bg, bar tracks |
| surfaceContainerLow/High | `#FBFCFE` / `#E9EEF5` | `#18202F` / `#202B40` | Dark input bg / selected-active rows, assistant bubble |
| onSurface / onSurfaceVariant | `#0F172A` / `#49586C` | `#E7EDF6` / `#9AA8BE` | Primary / secondary text |
| outline | `#7A8699` (3.69:1) | `#5E6F8D` (3.36:1) | **Functional** borders: inputs, checkboxes, unselected chips |
| outlineVariant | `#E1E7EE` | `#27324A` | **Decorative** hairlines: card edges, dividers (sub-3:1 by design) |
| error / errorContainer | `#C62B2B` / `#FBE1E1` | `#FF9F9F` / `#7C2222` | Destructive, validation, error states |
| success / warning / info (+Containers, on-colors) | see tokens | see tokens | Sync ok / offline banner / info banner, statuses |
| disabledText | `#8D99AA` | `#5F6E84` | Disabled labels ONLY (WCAG-exempt); never real copy |
| scrim / backdrop | `rgba(10,15,26,.48/.40)` | `rgba(0,0,0,.60/.52)` | Sidebar / modal backdrops |
| elevation.level0–5 | solid tinted hexes | solid tinted hexes | Feed Paper; MUST stay solid (translucent breaks Paper Surface shadows) |

Note: react-native-paper 5.15.3 `MD3Colors` has **no** `surfaceTint`/`surfaceContainer*` fields —
surface containers are our own token fields and reach Paper only via `colors.elevation.level0–5`.

**Chart / categorical palette** (`chartPalette.light|dark`, ≥3:1 on surface in both modes):
`["#4646D3","#0B7A6E","#A8580B","#BC3069","#0A64A0","#64748B"]` light,
`["#8F94F3","#3ECFBE","#F0A64B","#F383AE","#5BB7F5","#93A3B8"]` dark.

**Canonical category maps** (single source for accent bars, dots, legends — B and C and D must
agree; exported as `sourceColorIndex` / `noteCategoryColorIndex` in tokens.ts):

| Meeting source | chart index | Note category | chart index |
|---|---|---|---|
| manual | 0 (indigo) | general | 5 (slate) |
| ai_chat | 1 (teal) | work | 4 (sky) |
| google | 4 (sky) | ideas | 2 (amber) |
| device | 5 (slate) | personal | 3 (pink) |
| outlook | 3 (pink) | | |
| whatsapp | 2 (amber) | | |

This retires the hard-coded Google blue in `MeetingListItem.tsx` and the Tailwind hexes in
`notes/categoryStyle.ts` (both modules now source their values from these token maps —
`MeetingListItem.tsx` exports `sourceColor(category, colors)` / `meetingSourceColor(source,
colors)` and `notes/categoryStyle.ts` keeps its exported shape over `chartPalette`).
`chart[0]` is additionally guarded ≥3:1 on `surfaceVariant` (LoadByDay's fill on its track) in
`src/theme/__tests__/contrast.test.ts`.

**Alert-intensity identities** (mode-invariant; `alertMax` / `alertMedium` / `alertLight` token
groups, identical in both schemes — see §9).

**Elevation strategy (Android, flat-first):** cards = surface + 1px `outlineVariant` border +
`elevation: 0`. Real shadows (Paper elevation 2–3) only for: FAB, menus/popovers, modals/sheets,
toasts. Never border + shadow on the same element. Dark-mode shadows never hard-code `#000` —
use `colors.shadow`.

### 2.1 Gradients, depth and motion (visual refresh, October 30, 2026)

- **Gradients** (`gradients` / `onGradient` in tokens.ts, drawn ONLY through `GradientSurface`):
  `primary` (filled buttons, FABs, the header hairline, the active tab pill), `hero` (one banner
  per screen: the dashboard HeroCard), `ai` (the assistant orb and assistant tiles). Two stops,
  diagonal by default. Every stop was checked against its on-color (white on light primary / hero /
  ai at >= 4.5:1 for text, 4.3:1 on the lightest `ai` stop which carries icons only; indigo 10 on
  dark primary at >= 5.7:1). Never put a gradient behind body text or behind more than one block
  per screen.
- **Depth**: resting cards are `elevated` (`useAppTheme().elevated`): white surface with the
  indigo-tinted `softShadow` in light, elevation level1 + outlineVariant hairline in dark (shadows
  vanish on dark). Floating controls (GradientFab, the assistant orb) use `floatingShadow`
  (primary-colored). `variant="outlined"` keeps the flat hairline card for dense lists.
- **Light and spark** (decorative layers, pointerEvents none, hidden from screen readers, static
  under "reduce motion"): `AuroraBackdrop` (three drifting indigo / violet / teal blooms fading
  into the page, behind the dashboard greeting and stats), `Glow` (a radial bloom under the
  assistant orb and the focal card), `Shimmer` (a white light sweep every ~4.6 s across the focal
  card and the landing sign-in pill), `Sparkles` (four twinkling stars around the assistant orb).
  Never more than one aurora per screen and one shimmer per viewport. The dark scheme uses the same
  vivid indigo-to-violet ramps as light (white text) so gradients glow instead of washing out;
  `Card variant="glass"` (white at 6 percent dark / 72 percent light, faint light border) sits
  on the aurora. Cards never clip their own box (no `overflow: hidden` on a shadow host), so the
  elevation renders on Android; a child view clips ripples and accent bars instead.
- **Motion** (`motion` in tokens.ts; all of it skips under "reduce motion"): press feedback is a
  spring to 97 percent (`PressableScale`), blocks and rows fade-rise in over 360 ms (`Reveal`,
  rows staggered 40 ms up to index 8), the tab pill springs in, the assistant orb breathes
  (1.00 to 1.06, 2.4 s) until the chat is open, skeletons pulse (700 ms).

### 2.2 Icons (visual refresh, October 30, 2026)

One thin rounded line family: **Feather** (bundled with `@expo/vector-icons`), through the kit's
`Icon` component and its semantic names (`home`, `meetings`, `calendar`, `tasks`, `place`, `video`,
`alert`, ...). The assistant keeps Ionicons' `sparkles` (`name="ai"`). New code never imports an icon
family directly; MaterialCommunityIcons names survive only where Paper props or the EmptyState /
ListRow APIs take them. Sizes: 16 meta, 20 inline, 24 bars and rows, 22 in the tab bar.

## 3. Typography (`typography` in tokens.ts; Plus Jakarta Sans, loaded in AppRoot)

The app typeface is **Plus Jakarta Sans** (400 / 500 / 600 / 700 / 800, `@expo-google-fonts`), the
geometric humanist face of current planner apps. One family name per weight (`fontFamilies`); every
style sets the family of its weight and keeps `fontWeight: '400'` (Android would fake a bold on
top). Headlines are heavy and tight (headlineL 32/40 at -0.6, displayS 40/48 at -0.8), body relaxed.
Paper `<Text variant>` and Paper controls (`fonts.default`) use the same families. Until the fonts
load (a few tens of milliseconds, the native splash is still up) the system font shows.

| Variant | size/line | weight | Use |
|---|---|---|---|
| displayS | 36/44 | 700 | Onboarding hero, MAX alert title |
| headlineL | 28/36 | 700 | Dashboard greeting |
| headlineM | 24/32 | 700 | Pricing price, stat values |
| headlineS | 20/28 | 600 | Empty-state / modal / editor titles |
| titleL | 20/28 | 600 | Screen title — **header only**, screens never repeat it |
| titleM | 16/24 | 600 | Card & list-row titles, section rows |
| titleS | 14/20 | 600 | SectionHeader (sentence case — **no UPPERCASE**, no `textTransform`) |
| bodyL | 16/24 | 400 | Form values, chat, legal text |
| bodyM | 14/20 | 400 | Default body, descriptions |
| bodyS | 12/16 | 400 | Captions, timestamps, helper text |
| labelL | 14/20 | 600 | **All** buttons, chip labels |
| labelM | 12/16 | 500 | Badges, meta pills, day labels |
| labelS | 11/16 | 500 | Countdown legend, micro |

Rules: card title `titleM` + meta `bodyS onSurfaceVariant`; numbers (countdowns, stats, times)
get `fontVariant: ['tabular-nums']`; max 2 weights per surface; color does hierarchy before size.
Paper `Text variant=` maps 1:1 — Foundation applies weight bumps via `configureFonts`
(titleM/titleS → '600', headlines → '700'); default MD3 sizes already match.

## 4. Shape, space, metrics (tokens: `spacing`, `radii`, `componentMetrics`)

```
spacing: xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 40   (4pt grid ONLY)
radii:   xs 6 (badge) · sm 8 (chip, small button) · md 12 (input, list group, banner)
         lg 16 (card, toast) · xl 20 (FAB, modal) · sheet 28 (sheet top) · full 999 (pill)
```
@360dp: screen gutter 16 · section gap 24 · card padding 16, card gap 12 · button height 48
(small 40; ≥44 touch via hitSlop) · input height 52 (outlined, dense off) · list row minHeight 56
(two-line 72), row padding 16h/12v · icons 16 meta (beside bodyS/labelM) / 20 inline / 24 nav &
row-leading · avatar 40 · FAB 56.
Bordered = resting content; elevated = transient (menus, dialogs, toasts); tinted
(`surfaceContainerHigh`) = selected/active. This retires the audit's 17 ad-hoc radii, 18 paddings
and 13 font sizes.

## 5. Component kit — `src/components/ui/` (Foundation builds; everyone consumes)

All kit components: StyleSheet + tokens, typed props, `testID` pass-through, no new deps.
Promised signatures (implementers may rely on these):

```tsx
<MGButton variant?="filled"|"tonal"|"outline"|"ghost"|"destructive"   // default "filled"
          size?="md"|"sm" {...PaperButtonProps} />                    // wraps Paper Button, h 48/40, labelL
<Card onPress?={fn} accent?="none"|"primary" style? testID? >…</Card> // surface, r-lg, 1px outlineVariant,
                                                                      // p-16, elev 0; accent → primaryContainer
<SectionHeader title action?={{label, onPress}} trailing?={node}
               testID? />                                             // titleS onSurfaceVariant, mt 24 / mb 8;
                                                                      // trailing = plain node (count label, Badge)
<ListGroup>…</ListGroup>                                              // r-md container, internal hairlines
<ListRow icon?="calendar" title supporting? trailing?={node|"chevron"}
         tone?="default"|"destructive"                                // destructive: error title/icon + ripple
         onPress? selected? disabled? testID? accessibility* />       // minH 56, ripple onSurface@8%
<EmptyState icon title body action?={{label, onPress}} testID? />     // 96px surfaceVariant circle, 48 icon,
                                                                      // headlineS + bodyM, pv 40
<ErrorState body title? onRetry loading? testID? />                   // errorContainer circle + filled Retry;
                                                                      // loading: spinner + blocks re-entry;
                                                                      // never rendered beside cached content
<LoadingState testID? /> and <Skeleton width height radius? />        // spinner (primary) for first load;
                                                                      // skeleton only where layout is known:
                                                                      // surfaceVariant, r-sm, 700ms Animated 0.5→1
<Badge label tone?="neutral"|"primary"|"success"|"warning"|"error"|"info" testID? /> // r-xs, labelM, Container pairs
<Banner tone?="info"|"warning"|"error" icon? title? text action? testID? /> // r-md, Container bg, 20 icon,
                                                                      // labelL title line over bodyM text; slide-in
<SheetHandle />                                                       // 32×4 outline bar, self-centered
```

Known limitation: Paper's Button (and therefore MGButton) hard-codes
`accessibilityState={{ disabled }}` on its touchable, so a custom `accessibilityState` (e.g.
`busy`) never reaches the node. Surfaces whose tests or screen readers need `busy` keep bespoke
MG-spec Pressables (h 48, pill, labelL): the landing sign-in, the pricing buy/manage/restore
buttons and the confirmation-modal footer. Badge has no leading-icon slot and ListRow no
`numberOfLines`/middle-ellipsis for titles — the meeting-list repeat marker and the attachments
rows keep small local implementations for those.

Chips stay Paper `Chip` (themed): selected = `secondaryContainer` + check; unselected =
transparent + 1px `outline` + `onSurfaceVariant`. Inputs stay Paper `TextInput mode="outlined"`
with `outlineStyle={{ borderRadius: 12 }}`, label always visible (no placeholder-as-label), error
via `HelperText`. Dialogs/sheets: Portal + `scrim` token, surface `elevation.level3`, radius xl
(Paper Dialog's own 28 is acceptable = sheet token), padding 24, title headlineS, right-aligned
ghost/filled actions. FAB: primary, 56, radius xl, shadow allowed, hides on scroll-down;
Dashboard + Calendar + list screens only.

## 6. Foundation wiring (sequenced FIRST, before groups A–D)

1. `src/theme/tokens.ts` + `src/theme/index.ts` (**already landed with this doc** — typed final
   values + `useAppTheme()`).
2. `src/contexts/themeColors.ts`: build `MG_LIGHT`/`MG_DARK` MD3 themes —
   `{ ...MD3LightTheme, roundness: 3, colors: { ...MD3LightTheme.colors, ...paperColorOverrides.light } }`
   (`paperColorOverrides` is exported from tokens.ts with exactly the MD3 color keys, including
   solid `elevation` hexes and `surfaceDisabled`/`onSurfaceDisabled`). `PAPER_THEMES` returns
   them. `AppColors` is rebuilt **from tokens** keeping every legacy field name as an alias
   (`text→onSurface`, `textSecondary→onSurfaceVariant`, `border→outlineVariant`, `danger→error`,
   `onDanger→onError`, …) and gaining all new fields (`MGColors`), so the ~56 files reading
   `useTheme().colors` compile unchanged. `themeColors.ts` imports from `src/theme/tokens`
   **directly, never the `src/theme` barrel** (the barrel imports ThemeContext — cycle).
3. `src/contexts/ThemeContext.tsx`: `adaptNavigationTheme({ …, materialLight: MG_LIGHT,
   materialDark: MG_DARK })` so navigation backgrounds pick up the hue. Public API
   (`system/light/dark`, persistence, `useTheme().colors`) unchanged.
4. Typography: `fonts: configureFonts({ config: perVariantWeightBumps })` on both themes.
5. Build the §5 kit in `src/components/ui/` (+ render tests mirroring existing conventions).
6. Restyle shared shell: `CustomHeader` (surface bg, 1px bottom outlineVariant, minHeight 56 +
   insets, title titleL, 44×44 icon buttons with `android_ripple {onSurface@12%, borderless,
   radius:22}`, language pill surfaceVariant/r-full/labelM), `MobileSidebar` (surface bg, active
   route = secondaryContainer pill + onSecondaryContainer, inactive onSurfaceVariant, scrim
   token, shadow via colors.shadow), `BottomNavBar` (surface bg, 1px top outlineVariant, row
   `bottomBarHeight` 64 + bottom inset; Home, Meetings, AI, Calendar, Tasks; regular tabs get a
   56×32 r-full secondaryContainer pill that springs in behind the active icon (filled Ionicon,
   onSecondaryContainer), labelS label onSurface / onSurfaceVariant, onSurface@12% borderless
   ripple, role tab + selected; the AI item is a 56dp orb on the `ai` gradient raised 18dp above the
   bar with `floatingShadow`, a white@90% 3dp ring when the chat is open, breathing otherwise; the
   old floating assistant button is gone), the header hairline is a 2dp `primary` gradient,
   `ThemeToggle` (44×44, in the menu and in Settings; no longer in the header), the header itself now sits
   on the screen background with no hairline (logo or back, titleL title, EN/ES pill, 36dp gradient
   avatar with the user initial that opens the menu); the tab bar is a floating r-xxl pill 16dp from the
   sides on the background, `src/screens/shared/Section.tsx` /
   `ScreenBody` (bg background, gutter 16, paddingBottom insets.bottom+24; Section card = Card
   spec) — every screen inherits the new card baseline from here.
7. `src/services/alerts/expoNotificationsPort.ts`: notification accent `#1E40AF` → `#4646D3`.
8. Status-bar logic unchanged.

## 7. Per-screen redesign notes

Common to all screens: bg `background`; sentence-case SectionHeaders; empty/loading/error via the
kit (retires the audit's per-screen dashed boxes / plain text / bespoke errorBox); spacing and
radii only from tokens; hierarchy = one focal element per screen.

### Group A — auth, onboarding, legal, pricing, settings, alert settings
- **LandingScreen** (`auth/LandingScreen.tsx`): bg.jpg is the brand image (mark, app name and
  tagline baked in over a night office, 941 x 1672, always dark); the screen draws no logo or
  headline, a spacer keeps the content card below the image's tagline (card starts at 46% of the
  window) and the scrim is clear on top and night-dark behind the buttons; no content card, no
  value props, no quota note: only Apple (iOS) / Google / email buttons and the Terms and Privacy
  links sit on the image in white; buttons follow the
  MG filled/ghost spec (the sign-in stays a bespoke MG-spec Pressable — it asserts `busy`, see
  the §5 Paper Button limitation).
- **Onboarding** (`OnboardingLayout` + 5 steps): bg background; ProgressBar themed (primary);
  step title headlineS (hero step displayS), body bodyM onSurfaceVariant; option pickers
  (language, alert intensity, calendars) → `ListGroup`+`ListRow` with `selected` tint or Paper
  RadioButton; footer `MGButton` filled h 48 full-width.
- **AlertPreview** (`onboarding/AlertPreview.tsx`): rebuild mockups **from the `alertMax/Medium/
  Light` tokens** so the preview matches the real overlays pixel-for-pixel at card scale; device
  frame `surfaceVariant` + 1px outlineVariant (kills the #E2E8F0 dark-mode glare, audit #9).
- **LegalDocumentScreen**: prose page — bodyL line 24 onSurface, section headings titleM,
  meta bodyS onSurfaceVariant; no cards, gutter 16.
- **PricingScreen**: plan cards = `Card`; recommended plan: `accent="primary"` is NOT used —
  instead 2px `primary` border + `Badge tone="primary"` "recommended"; price headlineM
  tabular-nums + period bodyS; feature rows bodyM + 20px MCI check in `success`; period toggle →
  Paper SegmentedButtons; buy/manage/restore/retry follow the MG filled/outline pill spec as
  bespoke Pressables (they assert `busy` — §5 Paper Button limitation); keep
  `PILL_MAX_FONT_SCALE` guards and all purchase logic untouched.
- **SettingsScreen**: rows grouped in `ListGroup` per section (Settings pattern of §5);
  SectionHeader titleS; List.Item → `ListRow` (icon 24 onSurfaceVariant, trailing Switch/chevron);
  SegmentedButtons/Switch pick up the theme automatically; destructive (delete account) =
  `ListRow tone="destructive"` (error title/icon, error ripple); ThemeToggle stays Foundation's.
- **AlertSettingsScreen / AlertPreferencesForm** (`screens/alerts/`): same ListGroup pattern;
  intensity = choice chips (selected secondaryContainer); volume slider + switches themed; test
  buttons `MGButton tonal`; preview swatches from alert tokens.

### Group B — home, insights
- **DashboardScreen** (redesign 2026-11-01): the header shows no title on this screen; greeting
  headlineL + date bodyM onSurfaceVariant over the aurora; **StatsRow** is one glass strip (three
  segments: 30px tinted icon circle, titleL tabular value, labelS label, hairline separators);
  **NextMeetingCard is the single focal card**: `Card variant="gradient"` with `OrbitRings`
  (the welcome image's rings) fading top-right and a `Shimmer`, glass label + start-time pills,
  title headlineS, countdown headlineL tabular-nums, a 4dp elapsed bar for the meeting happening
  now, participant initials (max 3, "+N"), Join = `MGButton inverse` sm, Details ghost; all
  other sections are neutral `Card`s under `SectionHeader`s (titleM onSurface); error box →
  `ErrorState` (only when nothing cached — ARCHITECTURE §13 rule), empty → `EmptyState`,
  first load → skeleton cards.
- **QuickActions**: a row of four 56px round buttons with labelM labels: new meeting (primary
  gradient, plus), new with AI (ai gradient, sparkles), WhatsApp (tonal; disabled with a
  "Coming soon" caption until the bot is enabled), notes (tonal); PressableScale feedback, labels
  wrap instead of clipping.
- **TasksTodayCard**: header row titleM + neutral count pill + "View all" action; rows = 24px
  rounded-square checkbox (error border when overdue), title bodyL, status `Badge` (error
  "Overdue" / neutral time or "Today"), hairline between rows.
- **AlertStatusCard**: one pressable row card (the card opens Settings > Alerts, chevron at the
  right): bell on the primary gradient when on / bell-off on surfaceVariant when off, state
  titleM, intensity + scheduled count bodyS, success / warning Badge; the next alert and only the
  problem lines (permission, exact alarms, Do Not Disturb) below.
- **InsightsSummaryCard ("Your week")**: week count headlineS + time bodyS, today count at the
  right, `MiniBars` (7 days, today on the gradient, weekday initials), then the rest-of-week
  lines and the two buttons.
- **TodayTimelineRow**: an open list, no bordered cards: start time titleS tabular-nums (minWidth,
  not fixed width), 4px accent bar in source color (§2 map; current meeting = primary bar + row
  tinted surfaceContainerHigh; conflict = error bar), title titleS, range bodyS, state pill,
  chevron; hairline between rows. Density exception: the timeline's meeting titles
  stay titleS (not the §3 titleM row-title default) — the compact rail rows earn the smaller
  size; the meetings list keeps titleM for the same content.
- **OfflineBanner** → `Banner tone="warning"`; **AlertStatusCard** → Card, status via `Badge`
  (success "active" / warning "off"); **InsightsSummaryCard** → Card, values titleM tabular-nums.
- **AIInsightsScreen**: SegmentedButtons themed; stats → 2-col stat tiles (Card p-16: value
  headlineM tabular-nums + label bodyS onSurfaceVariant); **LoadByDay**: track surfaceVariant
  r-full h-8, fill `chart[0]`; replace fixed 56/96px label columns with flex `minWidth` +
  shrinkable bars so ES/scaled labels never truncate (audit #18); **AiSuggestionsSection**: Card,
  leading 20px MCI lightbulb in tertiaryContainer circle, bodyM; error → `ErrorState`.

### Group C — meetings (list/form/details), calendar, create, confirmation modal, badges
- **MeetingsListScreen**: Searchbar (themed, bg surfaceVariant); SegmentedButtons + filter chips
  per §5; section headers titleS; list gap 12; FAB primary (hides on scroll-down); empty →
  `EmptyState`, error → `ErrorState`.
- **MeetingListItem**: `Card` r-lg p-16; source accent = 4px r-full inset bar in §2 source color
  (retires Google blue #1A73E8); title titleM (2 lines max), time bodyM onSurfaceVariant
  tabular-nums, location bodyS; status/conflict → `Badge`; keep all testIDs/labels.
- **MeetingDetailsScreen**: fixes the "icon-row wall" (audit #12) — group into `ListGroup`
  sections under SectionHeaders (schedule / location / participants / preparation / notes);
  labels bodyS onSurfaceVariant, values bodyL onSurface; chips per §5; primary action (join) =
  `MGButton` filled, edit = tonal, delete = destructive ghost; attachments
  (`attachments/MeetingAttachmentsSection.tsx`) → `ListRow`s + tonal add button.
- **MeetingFormScreen** (873 lines — style pass only): all inputs per §5 Input spec; field
  groups separated by 24; date/time rows as `ListRow`-style pressables with outline border;
  chips choice-style; footer save `MGButton` filled h 48; errors via HelperText; keep every
  hook/validation path.
- **OccurrenceEditSheet**: sheet r-sheet top + `SheetHandle`; options as `ListRow`s; actions
  right-aligned ghost/filled. **meetingActions** dialogs: Paper Dialog themed (no bespoke colors).
- **CalendarScreen / MonthGrid**: weekday header labelM onSurfaceVariant; day cells sized from
  available width (min 40dp, aspectRatio 1) instead of fixed 32px (audit #18); today =
  primaryContainer circle + onPrimaryContainer; selected = primary circle + onPrimary; source
  dots 5px from §2 map; legend = dot + labelM; month nav arrows 44×44; FAB primary.
- **ChooseCreationMethodScreen**: three `Card onPress` rows: 40px primaryContainer icon circle
  (manual: pencil, AI: robot, WhatsApp: whatsapp MCI), title titleM + bodyM onSurfaceVariant,
  trailing chevron; WhatsApp row disabled: disabledText + `Badge tone="neutral"` "coming soon"
  (exact existing i18n key), no opacity-on-row.
- **MeetingConfirmationModal** (`components/MeetingConfirmationModal.tsx`): bottom sheet surface
  bg, r-sheet top, `SheetHandle`, title headlineS, detail rows as ListRow-likes, confirm =
  `MGButton` filled / cancel = ghost — replaces the emerald palette usage (audit #2 shared bit).
- **ConfidenceBadge** (`components/ConfidenceBadge.tsx`): reimplement on `Badge` tones —
  high→success, medium→warning, low→error Container pairs from tokens (retires 12 Tailwind
  hexes, audit #10); sizes labelM/labelS; keep `BADGE_MAX_FONT_SCALE` + labels.
- **MeetingStatus** (`screens/shared/MeetingStatus.tsx`): status colors → success/warning/error tokens.

### Group D — assistant, calendarSync, notes, alert overlays, toast, fallbacks
- **AssistantScreen**: keep the in-screen bar element and its testIDs, but restyle so it reads as
  one surface with the AppBar: bg surface, 1px bottom outlineVariant, compact (minHeight 44),
  subtitle titleS onSurfaceVariant (fixes audit #17 double-header); screen bg `background`
  (kills the #ffffff/#0f172a mismatch); composer: surface bar top-hairline, input
  surfaceContainerLow r-full bodyL, send button 44 primary circle; suggestion chips per §5;
  errors → `Banner tone="error"`.
- **ChatPieces**: user bubble = primary bg + onPrimary bodyL (6.82:1 — fixes audit #5's 3.77:1),
  assistant bubble = surfaceContainerHigh + onSurface, both r-lg with 4px tail corner, maxWidth
  ~80%, timestamps bodyS onSurfaceVariant outside the bubble; small buttons → `MGButton` sm.
- **ActionCard**: full width inside gutter (remove `marginLeft: 40`, audit #20); Card r-md;
  leading 20px icon in tertiaryContainer circle; primary line bodyM, meta bodyS (≥12, not 13px
  one-offs); confirm/cancel `MGButton` sm tonal/ghost.
- **presentation.ts `AssistantPalette`**: keep the interface + `assistantPalette(isDark)` /
  `feedbackColors` signatures; map every field to MG tokens (import from `src/theme/tokens`
  directly — it's a service-layer file), delete the emerald/slate literals (audit #2).
- **CalendarSyncScreen / CalendarSyncParts**: delete `palette.ts` values (keep the exported shape
  if imported elsewhere, sourcing from tokens); per-provider `ListGroup`: header row (provider
  icon 24, title titleM, status `Badge` success/error/info), body `ListRow`s with themed Paper
  Switch, footer `MGButton` tonal/outline (retires bespoke r-10 buttons, audit #3/#7); section
  titles → `SectionHeader`; bg `background` (kills #f8fafc jump); MaterialIcons → MCI where
  glyphs exist and no test asserts the name.
- **NotesScreen**: Searchbar themed; category filter chips = Paper chips + leading 8px dot in §2
  note-category color; FAB primary; empty → `EmptyState`.
- **NoteCard**: Card r-lg; 4px category accent bar (§2 map, replaces `categoryStyle.ts` hexes —
  keep its exported shape); title titleM, preview bodyM onSurfaceVariant (2 lines), meta bodyS;
  pinned = 16px MCI pin onSurfaceVariant.
- **NoteEditor**: full-screen modal surface bg; top bar minHeight 56: close 44×44, save `MGButton`
  ghost; title input headlineS-styled borderless TextInput; body bodyL; category = choice chips
  with dots; **MeetingPicker**: search + `ListRow`s.
- **Alert overlays**: see §9. **AppToast**: keeps the always-dark card in both modes — bg
  `alertLight.bg`, r-lg, left accent + icon in semantic dark-variant hue (success `#6CD9A0`,
  error `#FF9F9F`, info `#79C0F7`, warning `#F5B950` — AA on the dark card), title labelL
  `alertLight.title`, body bodyS `alertLight.body`, multi-line preserved, shadow allowed.
- **ErrorBoundary fallback**: may render with no providers — import `lightColors`/`darkColors`
  from `src/theme/tokens` directly and pick via `Appearance.getColorScheme()`; EmptyState-shaped
  layout, Retry = filled-style Pressable h 48 r-full primary (no context, no Paper).
- **NotConfiguredScreen**: intentionally fixed dark navy — leave behavior and structure;
  optionally align its literals to MG dark values as local constants (P3, no theme import).

## 8. States (all screens)

- **Loading** first paint: skeletons where layout is known (dashboard, lists), else centered
  Paper ActivityIndicator (primary). Never spinner + skeleton together.
- **Empty**: `EmptyState` — screen-appropriate MCI icon, headlineS title, bodyM ≤32ch, optional
  tonal action.
- **Error**: `ErrorState` with filled Retry — ONLY when there is nothing cached to show; cached
  content + `Banner tone="error"` otherwise (ARCHITECTURE §13).
- **Disabled**: `surfaceDisabled` fill + `disabledText` label; never `opacity` on a whole row.
- **Pressed**: `android_ripple` (primary@10% on cards, onSurface@8% on rows) + iOS fallback
  `opacity 0.96` (`pressedOpacity`). Pressables WITHOUT a ripple (alert-overlay buttons,
  banner/section-header text actions, bespoke pill buttons) use the visible dim
  `pressedDimOpacity` (0.75) on both platforms — 0.96 alone is imperceptible on Android.
  **Focus**: 2px primary border, offset 2.

## 9. Alert overlays (Group D; behavior untouched, tokens from `alertMax/Medium/Light`)

- **MAX** (`MaxAlertModal`): full-screen `alertMax.bg #3D0A12`; Animated pulse ring kept (scale
  1→1.15, reduce-motion path kept) — ring `ring #E5484D` + border `ringBorder #FF8A8F`; heading
  labelL `heading`; title displayS `title #FFFFFF`; time/when titleM tabular `when #FFD9A0`;
  countdown bar: track white@20%, fill `#FFD9A0`, h 6 r-full; buttons full-width h 52 r-md
  stacked: ACK = `ackBg #FFFFFF`/`ackText #8F1D2C`, JOIN = `joinBg #177245`/`joinText #FFFFFF`
  (5.98:1 — fixes audit #4's 3.30:1), SNOOZE = transparent + 1.5px `snoozeBorder` +
  `snoozeText`. Block-back, once-handlers, auto-snooze untouched.
- **MEDIUM** (`MediumAlertBanner`): card `alertMedium.bg rgba(22,31,46,0.97)`, r-md, 4px left
  `accentBar #F5B950`; title titleM `#FFFFFF`, body bodyM `body #C4CEDC`; action = `actionBg
  #F5B950`/`actionText #402500` labelL h 40; minimize chevron ≥44×44.
- **LIGHT** (`LightAlertToast`): card `alertLight.bg rgba(27,37,54,0.96)`, r-lg; icon 20
  `icon #AFB4FF`; title labelL `title #F1F5FA`, body bodyS `body #B9C4D4`; action `actionBg
  #4646D3`/white labelL sm; close 44×44; 3s auto-dismiss kept.

## 10. File ownership map (disjoint; Foundation sequenced first)

**Foundation (sequential, commits):** `src/theme/**` · `src/contexts/themeColors.ts` ·
`src/contexts/ThemeContext.tsx` · `src/components/ui/**` (new) · `src/components/CustomHeader.tsx`
· `src/components/MobileSidebar.tsx` · `src/components/ThemeToggle.tsx` ·
`src/screens/shared/Section.tsx` (ScreenBody) · `src/services/alerts/expoNotificationsPort.ts`
(accent hex only) · `src/navigation/AppRoot.tsx` (only if theme wiring needs it).

**A:** `src/screens/auth/**` · `src/screens/onboarding/**` (incl. `AlertPreview.tsx`) ·
`src/screens/legal/**` · `src/screens/pricing/**` · `src/screens/settings/**` ·
`src/screens/alerts/**` (AlertSettingsScreen + AlertPreferencesForm — the settings surfaces,
NOT the overlays).

**B:** `src/screens/home/**` · `src/screens/insights/**`.

**C:** `src/screens/meetings/**` (list/, form, details, occurrence sheet, meetingActions) ·
`src/screens/calendar/**` · `src/screens/create/**` · `src/screens/attachments/**` ·
`src/components/MeetingConfirmationModal.tsx` · `src/components/ConfidenceBadge.tsx` ·
`src/screens/shared/MeetingStatus.tsx`.

**D:** `src/screens/assistant/**` · `src/services/ai/presentation.ts` (palette section only) ·
`src/screens/calendarSync/**` (incl. `palette.ts`) · `src/screens/notes/**` (incl.
`categoryStyle.ts`) · `src/components/alerts/**` (MAX/MEDIUM/LIGHT overlays; NOT AlertHost
logic) · `src/components/AppToast.tsx` · `src/components/NotConfiguredScreen.tsx` (P3 optional)
· `src/components/ErrorBoundary.tsx` (fallback styles only).

No file appears in two groups. A group may add screen-local styles/subcomponents inside its own
folders; anything shared goes through Foundation's kit (ask the sequencer, don't duplicate).
Groups update their own `__tests__` snapshots/assertions only where a purely visual value was
asserted; guard tests (i18n parity, keysUsed, routeTitles) must pass unmodified.

## 11. Verification (every group, before handing back)

`npx tsc --noEmit` · `npm run lint` (`--max-warnings 0`) · `npm test` — all green; manual pass of
owned screens at 360dp, font scale 1.3×, light AND dark; no hex literals outside allowed files
(`grep -rn "#[0-9A-Fa-f]\{6\}" src --include="*.tsx" --include="*.ts"` minus
`src/theme/tokens.ts`, `NotConfiguredScreen.tsx` should trend to zero); final sequencer runs
`npx expo config --type prebuild` + `npm run apk:test`.
