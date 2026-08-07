/**
 * Phase S8 — Storage quota vs plan
 */

import { ApiError } from "./apiResponse.js";
import { getUserPlan } from "./plans.js";
import { userStorageBytes, userStorageMb } from "./userWorkspace.js";

export async function assertStorageAllowed(userId: string, additionalBytes = 0) {
  const plan = await getUserPlan(userId);
  const used = userStorageBytes(userId) + additionalBytes;
  const limit = plan.storageMb * 1024 * 1024;
  if (used > limit) {
    throw new ApiError(403, "storage_exceeded", "Storage limit exceeded for your plan", {
      usedMb: Math.round((used / (1024 * 1024)) * 100) / 100,
      limitMb: plan.storageMb,
      plan: plan.id,
    });
  }
  return {
    usedMb: userStorageMb(userId),
    limitMb: plan.storageMb,
    plan: plan.id,
  };
}

export async function storageStatus(userId: string) {
  const plan = await getUserPlan(userId);
  const usedMb = userStorageMb(userId);
  return {
    usedMb,
    limitMb: plan.storageMb,
    remainingMb: Math.max(0, Math.round((plan.storageMb - usedMb) * 100) / 100),
    plan: plan.id,
    percent: plan.storageMb ? Math.min(100, Math.round((usedMb / plan.storageMb) * 100)) : 0,
  };
}
