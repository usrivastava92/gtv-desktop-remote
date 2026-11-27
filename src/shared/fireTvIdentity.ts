type ProviderData = Record<string, string | number>;

export const FIRE_TV_DIAL_SERVICE = 'urn:dial-multiscreen-org:service:dial:1';

function mdnsIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().replace(/\.$/, '');
  return normalized.endsWith('._amzn-firetv._tcp.local') ? normalized : undefined;
}

function ssdpIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^uuid:[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** Only aliases observed together by native discovery connect the two protocols. */
export function fireTvIdentityMatches(
  left: { host: string; providerData?: ProviderData | undefined },
  right: { host: string; providerData?: ProviderData | undefined }
): boolean {
  const a = left.providerData;
  const b = right.providerData;
  if (!a?.identifier || !b?.identifier) return left.host === right.host;
  const aUuid = ssdpIdentifier(a.ssdpIdentifier) ?? ssdpIdentifier(a.identifier);
  const bUuid = ssdpIdentifier(b.ssdpIdentifier) ?? ssdpIdentifier(b.identifier);
  // A service instance name is not permission to override conflicting receiver UUIDs.
  if (aUuid && bUuid) return aUuid === bUuid;
  const aMdns = mdnsIdentifier(a.mdnsIdentifier) ?? mdnsIdentifier(a.identifier);
  const bMdns = mdnsIdentifier(b.mdnsIdentifier) ?? mdnsIdentifier(b.identifier);
  if (aMdns && bMdns && aMdns === bMdns) {
    // Name-only discovery cannot establish that a receiver moved to another IP.
    return left.host === right.host;
  }
  // Unknown identifiers, including SSDP's address-derived fallback, are not aliases.
  return a.identifier === b.identifier && left.host === right.host;
}

/** Keep learned aliases and DIAL readiness when the other discovery protocol answers next. */
export function mergeFireTvProviderData(
  previous: ProviderData | undefined,
  next: ProviderData | undefined
): ProviderData | undefined {
  if (!next) return previous;
  const merged = { ...previous, ...next };
  const mdns =
    mdnsIdentifier(next.mdnsIdentifier) ??
    mdnsIdentifier(next.identifier) ??
    mdnsIdentifier(previous?.mdnsIdentifier) ??
    mdnsIdentifier(previous?.identifier);
  const ssdp =
    ssdpIdentifier(next.ssdpIdentifier) ??
    ssdpIdentifier(next.identifier) ??
    ssdpIdentifier(previous?.ssdpIdentifier) ??
    ssdpIdentifier(previous?.identifier);
  if (mdns) merged.mdnsIdentifier = mdns;
  if (ssdp) {
    merged.identifier = ssdp;
    merged.ssdpIdentifier = ssdp;
  }
  if (previous?.serviceName === FIRE_TV_DIAL_SERVICE) merged.serviceName = FIRE_TV_DIAL_SERVICE;
  return merged;
}
