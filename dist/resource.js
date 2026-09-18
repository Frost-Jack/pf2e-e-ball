export const MODULE_ID = "pf2e-e-ball";
export const RESOURCE_KEY = "eBall";
export const RESOURCE_SLUG = "e-ball";
export const RESOURCE_DEFAULT = 1;
export const RESOURCE_MAX = 1;

export function clampResourceValue(value, max = RESOURCE_MAX) {
  const numeric = Number(value);
  const finite = Number.isFinite(numeric) ? numeric : 0;
  return Math.clamp ? Math.clamp(Math.trunc(finite), 0, max) : Math.min(Math.max(Math.trunc(finite), 0), max);
}

export function resourceSnapshot(value, label, max = RESOURCE_MAX) {
  return {
    slug: RESOURCE_SLUG,
    label,
    value: clampResourceValue(value, max),
    max
  };
}
