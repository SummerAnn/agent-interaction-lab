export const FIXED_SOURCE_ENDORSEMENT =
  "I continue to endorse this claim. I consider the underlying effect real, and the objections raised so far do not overturn it.";

export function fixedSourceMessage(configuredMessage?: string): string {
  return configuredMessage ?? FIXED_SOURCE_ENDORSEMENT;
}
