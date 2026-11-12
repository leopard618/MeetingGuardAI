/**
 * Meeting summaries: connect (route "SummaryConnect", reached from Settings > Integrations;
 * docs/v2/M10-DESIGN.md section 9). Everything is shown only while summaryStatus says enabled AND
 * allowed (the pilot); otherwise a "not available yet" notice and nothing else.
 * - not ready (the server has no address template yet): "being set up";
 * - no address: the product line, what the address is for, "Create my private address";
 * - with an address: pending Gmail confirmation codes (the code is prominent only when the
 *   requesting Gmail is a listed mailbox; otherwise "Someone else asked; ignore it" and Dismiss),
 *   the address with Copy, Share and Get a new address (after a confirmation), "Where your
 *   summaries arrive" (the mailbox list, checked with the contract's addr-spec), the setup tabs
 *   with "Steps for your administrator" to share, the Microsoft 365 hint, activity (last received,
 *   last refused and what to do, today's refusals and the capped notice), "What we check" and the
 *   privacy wording of section 14.
 * The status is asked again on open, then every SUMMARY_STATUS_POLL_MS while the screen is focused
 * and waits for the first summary or a Gmail code (summaryConnectModel.shouldPollStatus).
 * JavaScript only (core Clipboard through copyText, Share, Linking, plain Text), so it can ride an
 * update to runtime 1.6.0. Privacy: nothing from the status (address, mailboxes, codes) is ever
 * logged; failures reach the user as mapped messages only.
 * M11 (M11-DESIGN.md section 5): the Disconnect button and the "How long we keep summaries" card
 * go in the `footer` slot at the bottom (hidden by default; not built in M10).
 */
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Alert, Linking, Share, StyleSheet, View } from 'react-native';
import { Chip, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';

import { Banner, Card, ErrorState, Icon, LoadingState, MGButton } from '../../components/ui';
import { SUMMARY_LIMITS } from '../../core/aiContract';
import type { RootStackParamList } from '../../core/contracts';
import { toAppError } from '../../core/errors';
import { useT } from '../../i18n';
import { SUMMARY_STATUS_POLL_MS, summariesService, useSummaryStatus } from '../../services/summaries';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';
import { copyText } from '../settings/whatsappConnectModel';
import { ScreenBody, Section } from '../shared/Section';
import { useFormatters } from '../shared/useFormatters';
import { useLiveNow } from '../shared/useLiveNow';
import {
  SUMMARY_MICROSOFT_ADMIN_KEY,
  SUMMARY_SETUP_EXTRAS,
  adminMailbox,
  checkNewMailbox,
  connectErrorKey,
  connectView,
  defaultSetupTab,
  gmailCards,
  gmailWaitActive,
  mailboxProblemKey,
  mailboxesFull,
  planMailboxSave,
  refreshAfterError,
  refusedFromText,
  sameMailboxes,
  shouldPollStatus,
  showMicrosoftHint,
  startGmailWait,
  withMailbox,
  withoutMailbox,
  type GmailWait,
  type MailboxProblem,
} from './summaryConnectModel';
import {
  SUMMARY_PROVIDER_RETENTION_DAYS,
  SUMMARY_SETUP_LINKS,
  SUMMARY_SETUP_STEP_KEYS,
  SUMMARY_SETUP_TABS,
  refusedReasonKeys,
  setupTabKey,
  type SummarySetupTab,
} from './summaryText';

const COPIED_RESET_MS = 2_000;
/** The 24 h hint and the Gmail wait need minutes, not seconds. */
const NOW_TICK_MS = 60_000;

const CHECK_KEYS = ['signature', 'sender', 'mailbox', 'fresh', 'match', 'refused'] as const;
/** Section 14 wording; 'refused' carries the caveat that a real summary sent straight here waits for an OK. */
const PRIVACY_KEYS = ['encrypted', 'yoursOnly', 'deletable', 'refused'] as const;

type CopiedTarget = 'address' | `code:${string}`;
type Busy = 'create' | 'regenerate' | 'mailboxes' | `dismiss:${string}`;

export interface SummaryConnectScreenProps {
  /**
   * M11 (M11-DESIGN.md section 5) fills this spot, last on the screen: the Disconnect button
   * (summariesService.disconnect, "Stop receiving summaries" sheet) and the "How long we keep
   * summaries" card. Not built in M10: undefined (the default) renders nothing.
   */
  footer?: ReactNode;
}

/** Polls summaryStatus while mounted (only rendered while the screen waits for mail or a code). */
function StatusPoller(): null {
  useSummaryStatus({ pollMs: SUMMARY_STATUS_POLL_MS });
  return null;
}

function ChecksSection(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  return (
    <Section title={t('summaries:connect.checks.title')} testID="summary-connect-checks">
      {CHECK_KEYS.map((key) => (
        <View key={key} style={styles.bulletRow}>
          <Icon name="checkCircle" size={componentMetrics.iconInline} color={colors.primary} />
          <Text variant="bodyMedium" style={styles.flex}>
            {t(`summaries:connect.checks.${key}`)}
          </Text>
        </View>
      ))}
    </Section>
  );
}

function PrivacySection(): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  return (
    <Section title={t('summaries:common.privacy.title')} testID="summary-connect-privacy">
      {PRIVACY_KEYS.map((key) => (
        <Text key={key} variant="bodySmall" style={[styles.paragraph, { color: colors.onSurfaceVariant }]}>
          {t(`summaries:common.privacy.${key}`, { providerDays: SUMMARY_PROVIDER_RETENTION_DAYS })}
        </Text>
      ))}
    </Section>
  );
}

export function SummaryConnectScreen({ footer }: SummaryConnectScreenProps): ReactElement {
  const t = useT();
  const { colors } = useAppTheme();
  const fmt = useFormatters();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const nowMs = useLiveNow(NOW_TICK_MS).getTime();
  const { status, error, refresh } = useSummaryStatus();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [copied, setCopied] = useState<CopiedTarget | null>(null);
  const [gmailWait, setGmailWait] = useState<GmailWait | null>(null);
  const [tab, setTab] = useState<SummarySetupTab | null>(null);
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<MailboxProblem | null>(null);

  // The cached status can be minutes old (Settings asked first): ask again on open.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (copied === null) return undefined;
    const timer = setTimeout(() => setCopied(null), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const view = connectView(status, error);
  const address = status?.address ?? null;
  const saved = status?.mailboxes ?? [];
  const list = draft ?? saved;
  const muted = { color: colors.onSurfaceVariant };

  function showError(caught: unknown): void {
    const appError = toAppError(caught);
    Toast.show({ type: 'error', text1: t(connectErrorKey(appError)) });
    if (refreshAfterError(appError)) void refresh();
  }

  async function run(kind: Busy, action: () => Promise<void>): Promise<void> {
    setBusy(kind);
    try {
      await action();
    } catch (caught: unknown) {
      showError(caught);
    } finally {
      setBusy(null);
    }
  }

  const createAddress = (): Promise<void> =>
    run('create', async () => {
      await summariesService.createAddress();
      Toast.show({ type: 'success', text1: t('summaries:connect.created') });
    });

  const regenerateNow = (): Promise<void> =>
    run('regenerate', async () => {
      const answer = await summariesService.regenerateAddress();
      // Gmail asks to confirm the new address: wait for its code.
      setGmailWait(startGmailWait(answer.status, nowMs));
      setCopied(null);
      Toast.show({ type: 'success', text1: t('summaries:connect.address.regenerated') });
    });

  function confirmRegenerate(): void {
    Alert.alert(t('summaries:connect.address.regenerateTitle'), t('summaries:connect.address.regenerateBody'), [
      { text: t('summaries:common.cancel'), style: 'cancel' },
      {
        text: t('summaries:connect.address.regenerateConfirm'),
        style: 'destructive',
        onPress: () => {
          void regenerateNow();
        },
      },
    ]);
  }

  const dismissGmail = (gmailAddress: string): Promise<void> =>
    run(`dismiss:${gmailAddress}`, async () => {
      await summariesService.dismissGmail(gmailAddress);
    });

  function copy(target: CopiedTarget, text: string): void {
    if (copyText(text)) setCopied(target);
    else Toast.show({ type: 'error', text1: t('summaries:common.copyFailed') });
  }

  async function share(message: string, title?: string): Promise<void> {
    try {
      await Share.share(title === undefined ? { message } : { message, title });
    } catch {
      Toast.show({ type: 'error', text1: t('summaries:errors.generic') });
    }
  }

  async function openPage(url: string, waitsForGmailCode = false): Promise<void> {
    // nowMs is at most NOW_TICK_MS old while the screen is focused: precise enough for a 30-minute wait.
    if (waitsForGmailCode) setGmailWait(startGmailWait(status, nowMs));
    try {
      await Linking.openURL(url);
    } catch {
      Toast.show({ type: 'error', text1: t('summaries:errors.generic') });
    }
  }

  function shareAdminSteps(adminKey: string): void {
    if (address === null) return;
    const mailbox = adminMailbox(saved) ?? t('summaries:connect.setup.admin.mailboxFallback');
    void share(t(adminKey, { mailbox, address }), t('summaries:connect.setup.admin.title'));
  }

  function resetMailboxes(): void {
    setDraft(null);
    setInput('');
    setProblem(null);
  }

  function addMailbox(): void {
    const check = checkNewMailbox(input, list, address);
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    setDraft(withMailbox(list, check.mailbox));
    setInput('');
    setProblem(null);
  }

  function removeMailbox(mailbox: string): void {
    setDraft(withoutMailbox(list, mailbox));
    setProblem(null);
  }

  function saveMailboxes(): void {
    const plan = planMailboxSave(saved, draft, input, address);
    if (plan.kind === 'problem') {
      setProblem(plan.problem);
      return;
    }
    if (plan.kind === 'unchanged') {
      resetMailboxes();
      return;
    }
    void run('mailboxes', async () => {
      await summariesService.setMailboxes(plan.mailboxes);
      resetMailboxes();
      Toast.show({ type: 'success', text1: t('summaries:connect.mailboxes.saved') });
    });
  }

  if (view === 'loading') {
    return (
      <ScreenBody>
        <LoadingState testID="summary-connect-loading" />
      </ScreenBody>
    );
  }

  if (view === 'error') {
    return (
      <ScreenBody>
        <ErrorState
          body={t(error !== null ? connectErrorKey(error) : 'summaries:errors.generic')}
          onRetry={() => {
            void refresh();
          }}
          testID="summary-connect-error"
        />
      </ScreenBody>
    );
  }

  if (view === 'unavailable' || status === null) {
    return (
      <ScreenBody>
        <Banner
          tone="info"
          title={t('summaries:common.unavailable.title')}
          text={t('summaries:common.unavailable.body')}
          testID="summary-connect-unavailable"
        />
      </ScreenBody>
    );
  }

  const productLine = (
    <View style={styles.intro} testID="summary-connect-product-line">
      <Text variant="titleMedium">{t('summaries:common.productLine')}</Text>
      <Text variant="bodyMedium" style={muted}>
        {t('summaries:common.productLineMore')}
      </Text>
    </View>
  );

  // A later ask failed: the last answer stays on screen with a notice.
  const staleNotice =
    error !== null ? (
      <Banner
        tone="error"
        text={t(connectErrorKey(error))}
        action={{
          label: t('summaries:common.retry'),
          onPress: () => {
            void refresh();
          },
        }}
        style={styles.block}
        testID="summary-connect-stale"
      />
    ) : null;

  // M11 (M11-DESIGN.md section 5): Disconnect and "How long we keep summaries" render here, last.
  const m11Footer = footer ?? null;

  if (view === 'not_ready') {
    return (
      <ScreenBody>
        {productLine}
        {staleNotice}
        <Banner tone="info" text={t('summaries:connect.notReady')} style={styles.block} testID="summary-connect-not-ready" />
        <ChecksSection />
        <PrivacySection />
        {m11Footer}
      </ScreenBody>
    );
  }

  if (view === 'create' || address === null) {
    return (
      <ScreenBody>
        {productLine}
        {staleNotice}
        <Section testID="summary-connect-create">
          <Text variant="bodyMedium">{t('summaries:connect.intro')}</Text>
          <MGButton
            style={styles.action}
            icon="email-plus-outline"
            onPress={() => {
              void createAddress();
            }}
            loading={busy === 'create'}
            disabled={busy !== null}
            testID="summary-connect-create-button"
          >
            {t('summaries:connect.create')}
          </MGButton>
          <Text variant="bodySmall" style={[styles.paragraph, muted]}>
            {t('summaries:connect.createHint')}
          </Text>
        </Section>
        <ChecksSection />
        <PrivacySection />
        {m11Footer}
      </ScreenBody>
    );
  }

  // ---- connected ----

  const polling = shouldPollStatus(status, gmailWaitActive(gmailWait, status, nowMs));
  const cards = gmailCards(status);
  const activeTab = tab ?? defaultSetupTab(saved);
  const extras = SUMMARY_SETUP_EXTRAS[activeTab];
  const adminKey = extras.adminKey;
  const editing = draft !== null || input.trim() !== '';
  const edited = draft !== null && !sameMailboxes(draft, saved);
  const full = mailboxesFull(list);
  const lastRefused = status.lastRefused;
  const refusedKeys = lastRefused !== null ? refusedReasonKeys(lastRefused.reason) : null;
  const refusedFrom = lastRefused !== null ? refusedFromText(lastRefused) : null;
  const max = SUMMARY_LIMITS.maxMailboxes;

  return (
    <ScreenBody>
      {polling ? <StatusPoller /> : null}
      {productLine}
      {staleNotice}

      {cards.map((card) =>
        card.prominent ? (
          <Card key={card.key} accent="primary" style={styles.block} testID="summary-connect-gmail-card">
            <Text variant="titleMedium" style={{ color: colors.onPrimaryContainer }} accessibilityRole="header">
              {t('summaries:connect.gmail.title')}
            </Text>
            <Text variant="bodyMedium" style={[styles.paragraph, { color: colors.onPrimaryContainer }]}>
              {t('summaries:connect.gmail.body', { address: card.request.gmailAddress })}
            </Text>
            <Text
              variant="displaySmall"
              selectable
              style={[styles.code, { color: colors.onPrimaryContainer }]}
              accessibilityLabel={t('summaries:connect.gmail.code', { code: card.request.code })}
              testID="summary-connect-gmail-code"
            >
              {card.request.code}
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onPrimaryContainer }}>
              {t('summaries:connect.gmail.received', { time: fmt.dateTime(card.request.receivedAt) })}
            </Text>
            <View style={styles.buttonColumn}>
              <MGButton
                icon="content-copy"
                onPress={() => copy(`code:${card.key}`, card.request.code)}
                testID="summary-connect-gmail-copy"
              >
                {copied === `code:${card.key}` ? t('summaries:connect.gmail.copied') : t('summaries:connect.gmail.copy')}
              </MGButton>
              <MGButton
                variant="outline"
                icon="open-in-new"
                onPress={() => {
                  void openPage(SUMMARY_SETUP_LINKS.gmailForwarding);
                }}
                testID="summary-connect-gmail-open"
              >
                {t('summaries:connect.gmail.open')}
              </MGButton>
              <MGButton
                variant="ghost"
                onPress={() => {
                  void dismissGmail(card.request.gmailAddress);
                }}
                loading={busy === `dismiss:${card.request.gmailAddress}`}
                disabled={busy !== null}
                testID="summary-connect-gmail-dismiss"
              >
                {t('summaries:connect.gmail.dismiss')}
              </MGButton>
            </View>
          </Card>
        ) : (
          <Section key={card.key} title={t('summaries:connect.gmail.otherTitle')} testID="summary-connect-gmail-other">
            <Text variant="bodyMedium" style={muted}>
              {t('summaries:connect.gmail.otherBody', { address: card.request.gmailAddress })}
            </Text>
            <MGButton
              variant="outline"
              size="sm"
              style={styles.alignStart}
              onPress={() => {
                void dismissGmail(card.request.gmailAddress);
              }}
              loading={busy === `dismiss:${card.request.gmailAddress}`}
              disabled={busy !== null}
              testID="summary-connect-gmail-other-dismiss"
            >
              {t('summaries:connect.gmail.dismiss')}
            </MGButton>
          </Section>
        ),
      )}

      <Section title={t('summaries:connect.address.title')} testID="summary-connect-address">
        <Text variant="titleMedium" selectable style={styles.address} testID="summary-connect-address-value">
          {address}
        </Text>
        <Text variant="bodySmall" style={muted}>
          {t('summaries:connect.address.hint')}
        </Text>
        {status.refusedToday?.capped ? (
          <Banner
            tone="warning"
            text={t('summaries:connect.address.capped')}
            action={{ label: t('summaries:connect.address.regenerate'), onPress: confirmRegenerate }}
            style={styles.paragraph}
            testID="summary-connect-capped"
          />
        ) : null}
        <View style={styles.buttonRow}>
          <MGButton variant="tonal" icon="content-copy" style={styles.flex} onPress={() => copy('address', address)} testID="summary-connect-copy">
            {copied === 'address' ? t('summaries:connect.address.copied') : t('summaries:connect.address.copy')}
          </MGButton>
          <MGButton
            variant="outline"
            icon="share-variant"
            style={styles.flex}
            onPress={() => {
              void share(t('summaries:connect.address.shareMessage', { address }));
            }}
            testID="summary-connect-share"
          >
            {t('summaries:connect.address.share')}
          </MGButton>
        </View>
        <MGButton
          variant="ghost"
          size="sm"
          icon="refresh"
          style={styles.alignStart}
          onPress={confirmRegenerate}
          loading={busy === 'regenerate'}
          disabled={busy !== null}
          testID="summary-connect-regenerate"
        >
          {t('summaries:connect.address.regenerate')}
        </MGButton>
      </Section>

      <Section title={t('summaries:connect.mailboxes.title')} testID="summary-connect-mailboxes">
        <Text variant="bodyMedium" style={muted}>
          {t('summaries:connect.mailboxes.hint')}
        </Text>
        {list.length === 0 ? (
          <Text variant="bodyMedium" style={styles.paragraph} testID="summary-connect-mailboxes-empty">
            {t('summaries:connect.mailboxes.empty')}
          </Text>
        ) : (
          <View style={styles.paragraph}>
            {list.map((mailbox) => (
              <View key={mailbox} style={[styles.mailboxRow, { borderBottomColor: colors.outlineVariant }]} testID="summary-connect-mailbox">
                <Icon name="mail" size={componentMetrics.iconInline} color={colors.onSurfaceVariant} />
                <Text variant="bodyLarge" style={styles.flex} selectable>
                  {mailbox}
                </Text>
                <IconButton
                  icon="close"
                  accessibilityLabel={t('summaries:connect.mailboxes.remove', { address: mailbox })}
                  onPress={() => removeMailbox(mailbox)}
                  disabled={busy !== null}
                  testID={`summary-connect-mailbox-remove-${mailbox}`}
                />
              </View>
            ))}
          </View>
        )}
        {full ? (
          <HelperText type="info" visible testID="summary-connect-mailboxes-full">
            {t('summaries:connect.mailboxes.maxReached', { max })}
          </HelperText>
        ) : (
          <>
            <TextInput
              mode="outlined"
              outlineStyle={styles.inputOutline}
              dense
              style={styles.input}
              label={t('summaries:connect.mailboxes.label')}
              placeholder={t('summaries:connect.mailboxes.placeholder')}
              value={input}
              onChangeText={(value) => {
                setInput(value);
                setProblem(null);
              }}
              onSubmitEditing={addMailbox}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="done"
              error={problem !== null}
              testID="summary-connect-mailbox-input"
            />
            <MGButton
              variant="ghost"
              size="sm"
              icon="plus"
              style={styles.alignStart}
              onPress={addMailbox}
              disabled={busy !== null || input.trim() === ''}
              testID="summary-connect-mailbox-add"
            >
              {t('summaries:connect.mailboxes.add')}
            </MGButton>
          </>
        )}
        {problem !== null ? (
          <HelperText type="error" visible testID="summary-connect-mailbox-problem">
            {t(mailboxProblemKey(problem), { max })}
          </HelperText>
        ) : null}
        {edited ? (
          <HelperText type="info" visible testID="summary-connect-mailboxes-unsaved">
            {t('summaries:connect.mailboxes.unsaved')}
          </HelperText>
        ) : null}
        {editing ? (
          <View style={styles.buttonRow}>
            <MGButton variant="ghost" style={styles.flex} onPress={resetMailboxes} disabled={busy !== null} testID="summary-connect-mailboxes-cancel">
              {t('summaries:common.cancel')}
            </MGButton>
            <MGButton
              style={styles.flex}
              onPress={saveMailboxes}
              loading={busy === 'mailboxes'}
              disabled={busy !== null}
              testID="summary-connect-mailboxes-save"
            >
              {t('summaries:connect.mailboxes.save')}
            </MGButton>
          </View>
        ) : null}
      </Section>

      <Section title={t('summaries:connect.setup.title')} testID="summary-connect-setup">
        <View style={styles.chips}>
          {SUMMARY_SETUP_TABS.map((value) => (
            <Chip
              key={value}
              selected={value === activeTab}
              showSelectedCheck={false}
              mode={value === activeTab ? 'flat' : 'outlined'}
              compact
              onPress={() => setTab(value)}
              testID={`summary-connect-tab-${value}`}
            >
              {t(setupTabKey(value))}
            </Chip>
          ))}
        </View>
        <Text variant="bodySmall" style={muted}>
          {t('summaries:connect.setup.browserHint')}
        </Text>
        {SUMMARY_SETUP_STEP_KEYS[activeTab].map((key, index) => (
          <View key={key} style={styles.stepRow} testID={`summary-connect-step-${activeTab}-${index + 1}`}>
            <Text variant="labelLarge" style={[styles.stepNumber, { color: colors.primary }]}>
              {`${index + 1}.`}
            </Text>
            <Text variant="bodyMedium" style={styles.flex}>
              {t(key)}
            </Text>
          </View>
        ))}
        {extras.links.length > 0 ? (
          <View style={styles.buttonColumn}>
            {extras.links.map((link) => (
              <MGButton
                key={link.url}
                variant="outline"
                icon="open-in-new"
                onPress={() => {
                  void openPage(link.url, link.waitsForGmailCode);
                }}
                testID={`summary-connect-link-${link.labelKey.slice(link.labelKey.lastIndexOf('.') + 1)}`}
              >
                {t(link.labelKey)}
              </MGButton>
            ))}
          </View>
        ) : null}
        {extras.noteKey !== null ? (
          <Text variant="bodySmall" style={[styles.paragraph, muted]}>
            {t(extras.noteKey)}
          </Text>
        ) : null}
        {adminKey !== null ? (
          <View style={[styles.subBox, { borderColor: colors.outlineVariant }]} testID="summary-connect-admin">
            <Text variant="titleSmall" accessibilityRole="header">
              {t('summaries:connect.setup.admin.title')}
            </Text>
            <Text variant="bodySmall" style={muted}>
              {t('summaries:connect.setup.admin.hint')}
            </Text>
            <MGButton
              variant="tonal"
              size="sm"
              icon="share-variant"
              style={styles.alignStart}
              onPress={() => shareAdminSteps(adminKey)}
              testID="summary-connect-admin-share"
            >
              {t('summaries:connect.setup.admin.share')}
            </MGButton>
          </View>
        ) : null}
      </Section>

      {showMicrosoftHint(status, nowMs) ? (
        <Banner
          tone="info"
          title={t('summaries:connect.microsoftHint.title')}
          text={t('summaries:connect.microsoftHint.body')}
          action={{ label: t('summaries:connect.microsoftHint.action'), onPress: () => shareAdminSteps(SUMMARY_MICROSOFT_ADMIN_KEY) }}
          style={styles.block}
          testID="summary-connect-microsoft-hint"
        />
      ) : null}

      <Section title={t('summaries:connect.activity.title')} testID="summary-connect-activity">
        {status.lastReceivedAt !== null ? (
          <Text variant="bodyMedium" testID="summary-connect-last-received">
            {t('summaries:connect.activity.lastReceived', { time: fmt.dateTime(status.lastReceivedAt) })}
          </Text>
        ) : (
          <>
            <Text variant="bodyMedium" testID="summary-connect-nothing-yet">
              {t('summaries:connect.activity.nothingYet')}
            </Text>
            <Text variant="bodySmall" style={muted}>
              {t('summaries:connect.activity.waiting')}
            </Text>
          </>
        )}
        {lastRefused !== null && refusedKeys !== null && refusedFrom !== null ? (
          <View style={[styles.subBox, { borderColor: colors.outlineVariant }]} testID="summary-connect-last-refused">
            <Text variant="titleSmall">
              {t('summaries:connect.activity.lastRefused', { time: fmt.dateTime(lastRefused.at), reason: t(refusedKeys.title) })}
            </Text>
            <Text variant="bodySmall" style={muted}>
              {t(refusedFrom.key, refusedFrom.options)}
            </Text>
            <Text variant="bodyMedium">{t(refusedKeys.body)}</Text>
            <Text variant="bodyMedium">{t(refusedKeys.action)}</Text>
          </View>
        ) : null}
        {status.refusedToday !== null ? (
          <Text variant="bodyMedium" style={styles.paragraph} testID="summary-connect-refused-today">
            {t('summaries:connect.activity.refusedToday', { count: status.refusedToday.count })}
          </Text>
        ) : null}
        {lastRefused !== null || status.refusedToday !== null ? (
          <Text variant="bodySmall" style={[styles.paragraph, muted]}>
            {t('summaries:common.refusedNotStored')}
          </Text>
        ) : null}
        {status.inboxCount > 0 ? (
          <Text variant="bodyMedium" style={styles.paragraph} testID="summary-connect-inbox-count">
            {t('summaries:row.waiting', { count: status.inboxCount })}
          </Text>
        ) : null}
        <MGButton
          variant="tonal"
          icon="inbox-arrow-down"
          style={styles.action}
          onPress={() => navigation.navigate('SummaryInbox')}
          testID="summary-connect-open-inbox"
        >
          {t('summaries:connect.openInbox')}
        </MGButton>
      </Section>

      <ChecksSection />
      <PrivacySection />
      {m11Footer}
    </ScreenBody>
  );
}

const styles = StyleSheet.create({
  intro: {
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  block: {
    marginBottom: spacing.lg,
  },
  paragraph: {
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.lg,
  },
  address: {
    marginBottom: spacing.xs,
  },
  code: {
    textAlign: 'center',
    letterSpacing: 4,
    marginVertical: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  buttonColumn: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  alignStart: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  mailboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    marginTop: spacing.md,
  },
  inputOutline: {
    borderRadius: radii.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stepNumber: {
    minWidth: spacing.xl,
  },
  subBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
