/**
 * Invisible watcher that announces plan changes while the app is open: when the server-owned
 * entitlement flips (admin grant, purchase webhook, expiry), it shows a toast such as
 * "Your plan is now Pro". The first loaded value per account is the baseline and never toasts,
 * and switching accounts resets the baseline. Rendered once in AppRoot, inside DataProvider.
 */
import { useEffect, useRef } from 'react';
import Toast from 'react-native-toast-message';

import { useAuth } from '../services/auth';
import { useEntitlement } from '../services/data';
import { useT } from '../i18n';
import type { Plan } from '../core/aiContract';

export function PlanChangeNotice(): null {
  const t = useT();
  const { authUser } = useAuth();
  const { plan, isLoaded } = useEntitlement();
  const uid = authUser?.uid ?? null;
  const baseline = useRef<{ uid: string; plan: Plan } | null>(null);

  useEffect(() => {
    if (uid === null || !isLoaded) {
      if (uid === null) baseline.current = null;
      return;
    }
    const prev = baseline.current;
    baseline.current = { uid, plan };
    if (prev === null || prev.uid !== uid || prev.plan === plan) return;
    Toast.show({
      type: 'success',
      text1: t('pricing:planChanged.title'),
      text2: t('pricing:planChanged.body', { plan: t(`pricing:plans.${plan}.name`) }),
    });
  }, [uid, plan, isLoaded, t]);

  return null;
}
