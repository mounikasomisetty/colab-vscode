/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import sinon from "sinon";
import { ControllableAsyncToggle, Deferred } from "../test/helpers/async";
import { ColabLogWatcher } from "../test/helpers/logging";
import { newVsCodeStub } from "../test/helpers/vscode";
import { LogLevel } from "./logging";
import { AsyncToggle } from "./toggleable";

/**
 * A derived class with the abstract methods of the SUT (AsyncToggle) stubbed.
 */
class TestToggle extends AsyncToggle {
  readonly turnOnStub: sinon.SinonStub<[AbortSignal], Promise<void>> =
    sinon.stub();
  readonly turnOffStub: sinon.SinonStub<[AbortSignal], Promise<void>> =
    sinon.stub();

  override turnOn = this.turnOnStub;
  override turnOff = this.turnOffStub;

  /**
   * Gate the completion of the asynchronous `turnOn` or `turnOff` method.
   *
   * @param turning - the direction to gate.
   */
  gate(turning: "turnOn" | "turnOff", call: number): () => void {
    const turn = turning === "turnOn" ? this.turnOnStub : this.turnOffStub;
    const d = new Deferred<void>();
    turn.onCall(call).callsFake((_s) => {
      return d.promise;
    });
    return d.resolve;
  }
}

describe("AsyncToggle", () => {
  let logs: ColabLogWatcher;
  let toggle: TestToggle;
  let toggleSpy: ControllableAsyncToggle;

  beforeEach(() => {
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Trace);
    toggle = new TestToggle();
    toggleSpy = new ControllableAsyncToggle(toggle);
  });

  afterEach(() => {
    logs.dispose();
  });

  describe("on", () => {
    it("should turn on when called", async () => {
      toggle.on();

      await toggleSpy.turnOn.call(0).waitForCompletion();
    });

    it("should not supersede in-flight toggles on", async () => {
      const firstCall = toggleSpy.turnOn.call(0);
      const completeFirst = toggle.gate("turnOn", 0);
      toggle.on();

      // Second call.
      toggle.on();

      // Allow the first call to complete.
      completeFirst();
      await firstCall.waitForCompletion();

      // Verify the second never ran.
      expect(toggleSpy.turnOn.callCount).to.equal(1);
    });

    it("should be cancelled if off is called", async () => {
      const turnOn = toggleSpy.turnOn.call(0);
      // Never let the first call complete.
      toggle.gate("turnOn", 0);
      toggle.on();
      await turnOn.waitForStart();
      const turnOnAbort = toggle.turnOnStub.firstCall.args[0];

      // Toggle off before on completes.
      const turnOff = toggleSpy.turnOff.call(0);
      const completeTurnOff = toggle.gate("turnOff", 0);
      toggle.off();
      await turnOff.waitForStart();

      // Verify toggling on was aborted.
      expect(turnOnAbort.aborted).to.be.true;
      // Verify turning off can complete.
      completeTurnOff();
      await expect(turnOff.waitForCompletion()).to.eventually.be.fulfilled;
    });

    it("should handle failures toggling on gracefully", async () => {
      const firstCall = toggleSpy.turnOn.call(0);
      toggle.turnOnStub.rejects(new Error("🤮"));
      toggle.on();
      await firstCall.waitForStart();

      await firstCall.waitForCompletion();
      expect(logs.output).to.match(/failed unexpectedly/);

      // Verify it can be turned on again
      toggle.turnOnStub.resolves();
      const secondCall = toggleSpy.turnOn.call(1);
      toggle.on();
      await expect(secondCall.waitForCompletion()).to.eventually.be.fulfilled;
      expect(logs.output).to.match(/on completed successfully/);
    });

    it("should be able to turn off after failing to turn on", async () => {
      const turnOnCall = toggleSpy.turnOn.call(0);
      toggle.turnOnStub.rejects(new Error("🤮"));
      toggle.on();
      await turnOnCall.waitForStart();

      await turnOnCall.waitForCompletion();
      expect(logs.output).to.match(/failed unexpectedly/);

      // Verify it can be turned off
      const turnOffCall = toggleSpy.turnOff.call(0);
      toggle.off();
      await expect(turnOffCall.waitForCompletion()).to.eventually.be.fulfilled;
    });
  });

  describe("off", () => {
    it("should turn off when called", async () => {
      toggle.off();

      await toggleSpy.turnOff.call(0).waitForCompletion();
    });

    it("should not supersede in-flight toggles off", async () => {
      const firstCall = toggleSpy.turnOff.call(0);
      const completeFirst = toggle.gate("turnOff", 0);
      toggle.off();

      // Second call.
      toggle.off();

      // Allow the first call to complete.
      completeFirst();
      await firstCall.waitForCompletion();

      // Verify the second never ran.
      expect(toggleSpy.turnOff.callCount).to.equal(1);
    });

    it("should be cancelled if on is called", async () => {
      const turnOff = toggleSpy.turnOff.call(0);
      // Never let the first call complete.
      toggle.gate("turnOff", 0);
      toggle.off();
      await turnOff.waitForStart();
      const turnOffAbort = toggle.turnOffStub.firstCall.args[0];

      // Toggle on before off completes.
      const turnOn = toggleSpy.turnOn.call(0);
      const completeTurnOn = toggle.gate("turnOn", 0);
      toggle.on();
      await turnOn.waitForStart();

      // Verify toggling off was aborted.
      expect(turnOffAbort.aborted).to.be.true;
      // Verify turning on can complete.
      completeTurnOn();
      await expect(turnOn.waitForCompletion()).to.eventually.be.fulfilled;
    });

    it("should handle failures toggling off gracefully", async () => {
      const firstCall = toggleSpy.turnOff.call(0);
      toggle.turnOffStub.rejects(new Error("🤮"));
      toggle.off();
      await firstCall.waitForStart();

      await firstCall.waitForCompletion();
      expect(logs.output).to.match(/failed unexpectedly/);

      // Verify it can be turned off again
      toggle.turnOffStub.resolves();
      const secondCall = toggleSpy.turnOff.call(1);
      toggle.off();
      await expect(secondCall.waitForCompletion()).to.eventually.be.fulfilled;
      expect(logs.output).to.match(/off completed successfully/);
    });

    it("should be able to turn on after failing to turn off", async () => {
      const turnOffCall = toggleSpy.turnOff.call(0);
      toggle.turnOffStub.rejects(new Error("🤮"));
      toggle.off();
      await turnOffCall.waitForStart();

      await turnOffCall.waitForCompletion();
      expect(logs.output).to.match(/failed unexpectedly/);

      // Verify it can be turned off
      const turnOnCall = toggleSpy.turnOn.call(0);
      toggle.on();
      await expect(turnOnCall.waitForCompletion()).to.eventually.be.fulfilled;
    });
  });

  it("should handle rapid toggling", async () => {
    // Start toggling on but gate it from completing.
    toggle.gate("turnOn", 0);
    toggle.on();
    await toggleSpy.turnOn.call(0).waitForStart();

    // Toggle off before on completes.
    toggle.gate("turnOff", 0);
    toggle.off();
    await toggleSpy.turnOff.call(0).waitForStart();

    // Assert the toggle on aborted.
    const turnOnAbort = toggle.turnOnStub.firstCall.args[0];
    expect(turnOnAbort.aborted).to.be.true;

    // Toggle on to completion before off completes.
    toggle.on();
    await toggleSpy.turnOn.call(1).waitForCompletion();

    // Assert the toggle off aborted.
    const turnOffAbort = toggle.turnOffStub.firstCall.args[0];
    expect(turnOffAbort.aborted).to.be.true;
  });
});
