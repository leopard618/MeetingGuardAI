/**
 * Firebase transport for the assistant callable + NetInfo connectivity probe.
 *
 * httpsCallable(getFunctions(app, env.functionsRegion), 'assistant', { timeout }) — the region
 * must match the deployed functions (EXPO_PUBLIC_FUNCTIONS_REGION, default us-central1).
 * In development builds with EXPO_PUBLIC_USE_EMULATORS the Functions emulator is used
 * (connectFunctionsEmulator only sets the instance origin, so repeating it is harmless).
 */
import NetInfo from '@react-native-community/netinfo';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';

import { app } from '../../config/firebase';
import { env } from '../../config/env';
import { CALLABLES, type AssistantRequest } from '../../core/aiContract';
import { createLogger } from '../../core/logger';

import type { AssistantTransport, ConnectivityProbe } from './assistantClient';

const log = createLogger('ai.transport');

const FUNCTIONS_EMULATOR_PORT = 5001;

let functionsInstance: Functions | null = null;

function getFunctionsInstance(): Functions | null {
  if (!app) return null;
  if (functionsInstance) return functionsInstance;
  const instance = getFunctions(app, env.functionsRegion);
  if (typeof __DEV__ !== 'undefined' && __DEV__ && env.useEmulators) {
    try {
      connectFunctionsEmulator(instance, env.emulatorHost, FUNCTIONS_EMULATOR_PORT);
    } catch (error) {
      log.error('could not connect the Functions emulator', error);
    }
  }
  functionsInstance = instance;
  return instance;
}

export function getFirebaseAssistantTransport(): AssistantTransport | null {
  const instance = getFunctionsInstance();
  if (!instance) return null;
  return {
    async call(request: AssistantRequest, options: { timeoutMs: number }): Promise<unknown> {
      const callable = httpsCallable<AssistantRequest, unknown>(instance, CALLABLES.assistant, {
        timeout: options.timeoutMs,
      });
      const result = await callable(request);
      return result.data;
    },
  };
}

export const netInfoConnectivity: ConnectivityProbe = {
  async isOffline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected === false;
  },
};
