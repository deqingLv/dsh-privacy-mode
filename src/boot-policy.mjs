import boot from './boot-policy.cjs';
export const { BOOT_POLICY_KEY, resolveBootPolicy } = boot;
export const bootPolicy = resolveBootPolicy;
