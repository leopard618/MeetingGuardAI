/**
 * One suggested task of a commitments review (owner: summaries-app; M11, docs/v2/M11-DESIGN.md
 * sections 3.2 and 11): a checkbox, the title as it will be added, the owner and due lines, the
 * flags as chips with the reason of an unticked one, the source's own words under "From the
 * summary:" (the whole item or the whole sentence, plain text: a link in it is never tappable),
 * and the actions the caller passes (Edit and Drop; Open task and Undo; Add again; Restore).
 *
 * Generic (decision 15): every text and action comes in as a prop, so Sven's A2 reuses it for
 * "From the email:" with its own origin texts. The action labels are the caller's too.
 * White card, blue accent for the ticked state, no motion.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';

import { Badge, Card, MGButton, type BadgeTone, type MGButtonVariant } from '../ui';
import { componentMetrics, radii, spacing, useAppTheme } from '../../theme';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface CommitmentCardChip {
  label: string;
  tone: BadgeTone;
}

export interface CommitmentCardAction {
  /** Stable id (testID suffix). */
  id: string;
  label: string;
  icon?: IconName;
  variant?: MGButtonVariant;
  onPress(): void;
}

export interface CommitmentCardSelection {
  selected: boolean;
  onToggle(): void;
  /** "Select: <title>". */
  accessibilityLabel: string;
}

export interface CommitmentCardProps {
  /** Stable id of the suggestion (testIDs). */
  id: string;
  title: string;
  /** "From the summary:" (A2: "From the email:"). */
  quoteLabel: string;
  /** The source's own words, verbatim, plain text. */
  quote: string;
  owner: string;
  /** "A follow-up for you: the task title starts with Bish." */
  ownerNote?: string | null;
  due?: readonly string[];
  /** "Section: Action items". */
  section?: string | null;
  chips?: readonly CommitmentCardChip[];
  /** Why it is not ticked. */
  reason?: string | null;
  /** Small notes under everything ("Edited by you", "Prepare the suggestions again to change this one."). */
  notes?: readonly string[];
  /** "In your tasks", "Removed from your tasks"; null for an open suggestion. */
  status?: { label: string; tone: BadgeTone; detail?: string | null } | null;
  /** null: no checkbox (accepted, dropped, read-only). */
  selection?: CommitmentCardSelection | null;
  actions?: readonly CommitmentCardAction[];
  disabled?: boolean;
  testID?: string;
}

export function CommitmentCard({
  id,
  title,
  quoteLabel,
  quote,
  owner,
  ownerNote = null,
  due = [],
  section = null,
  chips = [],
  reason = null,
  notes = [],
  status = null,
  selection = null,
  actions = [],
  disabled = false,
  testID = `commitment-${id}`,
}: CommitmentCardProps): ReactElement {
  const { colors, isDark } = useAppTheme();
  const muted = { color: colors.onSurfaceVariant };
  const selected = selection?.selected === true;
  // The same 1px edge in both states, so ticking never moves the layout.
  const edge = { borderWidth: 1, borderColor: selected ? colors.primary : isDark ? colors.outlineVariant : 'transparent' };
  return (
    <Card style={[styles.card, edge]} testID={testID}>
      <View style={styles.head}>
        {selection !== null ? (
          <View style={styles.checkbox}>
            <Checkbox.Android
              status={selected ? 'checked' : 'unchecked'}
              onPress={selection.onToggle}
              disabled={disabled}
              color={colors.primary}
              uncheckedColor={colors.outline}
              accessibilityLabel={selection.accessibilityLabel}
              testID={`${testID}-select`}
            />
          </View>
        ) : null}
        <View style={styles.flex}>
          <Text variant="titleSmall" selectable testID={`${testID}-title`}>
            {title}
          </Text>
          {status !== null ? (
            <View style={styles.statusRow}>
              <Badge label={status.label} tone={status.tone} testID={`${testID}-status`} />
              {status.detail ? (
                <Text variant="bodySmall" style={muted}>
                  {status.detail}
                </Text>
              ) : null}
            </View>
          ) : null}
          <MetaLine icon="account-outline" text={owner} testID={`${testID}-owner`} />
          {ownerNote !== null ? (
            <Text variant="bodySmall" style={[styles.indented, muted]} testID={`${testID}-owner-note`}>
              {ownerNote}
            </Text>
          ) : null}
          {due.map((line, index) => (
            <MetaLine key={`${index}-${line}`} icon={index === 0 ? 'calendar-clock' : null} text={line} testID={`${testID}-due-${index}`} />
          ))}
          {section !== null ? <MetaLine icon="format-list-bulleted" text={section} testID={`${testID}-section`} /> : null}
        </View>
      </View>

      {chips.length > 0 ? (
        <View style={styles.chips} testID={`${testID}-chips`}>
          {chips.map((chip) => (
            <Badge key={chip.label} label={chip.label} tone={chip.tone} style={styles.chip} />
          ))}
        </View>
      ) : null}
      {reason !== null ? (
        <Text variant="bodySmall" style={[styles.line, muted]} testID={`${testID}-reason`}>
          {reason}
        </Text>
      ) : null}

      <View style={[styles.quote, { borderLeftColor: colors.outlineVariant }]} testID={`${testID}-quote-block`}>
        <Text variant="labelMedium" style={muted}>
          {quoteLabel}
        </Text>
        <Text variant="bodyMedium" selectable style={styles.quoteText} testID={`${testID}-quote`}>
          {quote}
        </Text>
      </View>

      {notes.map((note) => (
        <Text key={note} variant="bodySmall" style={[styles.line, muted]}>
          {note}
        </Text>
      ))}

      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <MGButton
              key={action.id}
              variant={action.variant ?? 'ghost'}
              size="sm"
              icon={action.icon}
              onPress={action.onPress}
              disabled={disabled}
              style={styles.action}
              testID={`${testID}-${action.id}`}
            >
              {action.label}
            </MGButton>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function MetaLine({ icon, text, testID }: { icon: IconName | null; text: string; testID?: string }): ReactElement {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metaLine}>
      {icon !== null ? (
        <MaterialCommunityIcons
          name={icon}
          size={componentMetrics.iconMeta}
          color={colors.onSurfaceVariant}
          style={styles.metaIcon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : (
        <View style={styles.metaSpacer} />
      )}
      <Text variant="bodySmall" style={[styles.flex, { color: colors.onSurfaceVariant }]} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    marginLeft: -spacing.sm,
    marginTop: -spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaIcon: {
    marginTop: 1,
  },
  metaSpacer: {
    width: componentMetrics.iconMeta,
  },
  indented: {
    marginLeft: componentMetrics.iconMeta + spacing.xs,
    marginTop: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  chip: {
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  line: {
    marginTop: spacing.xs,
  },
  quote: {
    marginTop: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: 3,
    borderRadius: radii.xs,
  },
  quoteText: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginLeft: -spacing.sm,
  },
  action: {
    marginRight: spacing.xs,
  },
});
