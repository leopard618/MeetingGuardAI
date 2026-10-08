/**
 * Side-effect entry (owner: widget): index.js imports this module ONCE, after
 * './src/services/alerts/tasks', so the feeder's event subscriptions exist before the root
 * component registers and headless background runs feed the widget too (§19). Kept separate from
 * ./index.ts so importing the barrel (tests, future callers) never has side effects.
 */
import { registerWidgetFeeder } from './index';

registerWidgetFeeder();
