// Re-export shim — moved to src/backend/protocol/androidtv/certificate.ts.
// This shim is deleted in PR-3 once src/main/device/androidTvRemote.ts is
// itself broken up. Keeping it here means PR-2 changes zero call sites.
export * from '../../../backend/protocol/androidtv/certificate';
