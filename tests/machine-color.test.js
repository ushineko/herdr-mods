import { test } from "node:test";
import assert from "node:assert/strict";
import { machineColor, MACHINE_COLORS } from "../lib/machine-color.js";

const ours = ["njv-cachyos-default", "njv-cachyos-work", "njv-mbp-m1", "win11-kvm"];

test("machineColor: this computer has none; a machine has one from the palette", () => {
  assert.equal(machineColor(null, ours), null);
  assert.equal(machineColor("", ours), null);
  assert.ok(MACHINE_COLORS.includes(machineColor("njv-mbp-m1", ours)));
});

test("machineColor: a window's machines never share a colour while there are colours left", () => {
  const colors = ours.map((n) => machineColor(n, ours));
  assert.equal(new Set(colors).size, ours.length);
});

test("machineColor: stable, and the same whatever order the machines are listed in", () => {
  assert.equal(machineColor("njv-cachyos-work", ours), machineColor("njv-cachyos-work", [...ours].reverse()));
  assert.equal(machineColor("njv-cachyos-work", ours), machineColor("njv-cachyos-work", ours));
});
