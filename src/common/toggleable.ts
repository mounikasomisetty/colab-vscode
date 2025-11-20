/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { log } from "./logging";

/**
 * An entity which can be turned "on" and "off".
 */
export interface Toggleable {
  /**
   * Turn on the toggle.
   */
  on(): void;

  /**
   * Turn off the toggle.
   */
  off(): void;
}

type ToggleDirection = Lowercase<keyof Toggleable>;

class ToggleAbortedError extends Error {
  constructor(from: ToggleDirection, to: ToggleDirection) {
    super(`Toggling from ${from} superseded by toggle to ${to}`);
  }
}

/**
 * Manages toggling on and off asynchronously.
 *
 * Derived classes are responsible for object lifecycle of any resources created
 * when toggling.
 */
export abstract class AsyncToggle implements Toggleable {
  private inFlight?: { ctrl: AbortController; to: ToggleDirection };

  protected abstract turnOn(signal: AbortSignal): Promise<void>;
  protected abstract turnOff(signal: AbortSignal): Promise<void>;

  on(): void {
    void this.toggle("on");
  }

  off(): void {
    void this.toggle("off");
  }

  protected async toggle(to: ToggleDirection): Promise<void> {
    if (this.inFlight) {
      // Already toggling in that direction.
      if (this.inFlight.to === to) {
        return;
      }
      this.inFlight.ctrl.abort(new ToggleAbortedError(this.inFlight.to, to));
    }

    const ctrl = new AbortController();
    this.inFlight = { ctrl, to };

    try {
      await (to === "on"
        ? this.turnOn(ctrl.signal)
        : this.turnOff(ctrl.signal));

      // If this is no longer the active operation, stop.
      if (!this.hasActiveControl(ctrl)) {
        log.trace(`Completed toggle to ${to} but a new one superseded it.`);
        return;
      }

      log.trace(`Async toggle to ${to} completed successfully.`);
    } catch (err: unknown) {
      // Toggling superseded, this no longer has active control.
      if (ctrl.signal.aborted) {
        log.trace(`Async toggle aborted.`, err);
        return;
      }

      // A non-aborted failure.
      log.error(`Async toggle to ${to} failed unexpectedly.`, err);
      throw err;
    } finally {
      // Only clear if this is still the active operation.
      if (this.hasActiveControl(ctrl)) {
        this.inFlight = undefined;
      }
    }
  }

  /**
   * Checks if the given controller matches the active in-flight operation.
   *
   * Within {@link AsyncToggle.toggle | toggle}, the `await` call yields
   * control to the event loop. In that gap, `this.inFlight` can change
   * (specifically, it can be set to undefined by the finally block of a
   * superseding call).
   *
   * While the check is trivial, it's lifted to make the seemingly redundant
   * checks more obvious, with justification.
   */
  private hasActiveControl(ctrl: AbortController): boolean {
    return this.inFlight?.ctrl === ctrl;
  }
}
