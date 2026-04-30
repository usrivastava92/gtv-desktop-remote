import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { DiscoveredDevice } from '../../shared/types';

interface ResolvedService {
  instanceName: string;
  hostName?: string;
  host?: string;
  port?: number;
  txt: Record<string, string>;
}

function decodeDnsSdValue(value: string): string {
  return value.replace(/\\032/g, ' ').replace(/\\ /g, ' ').replace(/\\\\/g, '\\');
}

function buildDiscoveredId(host: string, name: string): string {
  return createHash('sha1').update(`${host}:${name}`).digest('hex').slice(0, 12);
}

function runDnsSd(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('dns-sd', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      resolve(stdout);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (code === 0 || code === null) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `dns-sd exited with code ${String(code)}`));
    });
  });
}

async function browseServiceInstances(serviceType: string, timeoutMs = 2500): Promise<string[]> {
  const output = await runDnsSd(['-B', serviceType, 'local.'], timeoutMs);
  const lines = output.split(/\r?\n/);
  const instances = new Set<string>();

  for (const line of lines) {
    if (!line.includes(' Add ') || !line.includes(serviceType)) {
      continue;
    }

    const parts = line.trim().split(/\s{2,}/);
    const instanceName = parts[parts.length - 1]?.trim();
    if (instanceName && instanceName !== '...STARTING...') {
      instances.add(instanceName);
    }
  }

  return [...instances];
}

function parseTxtRecord(line: string): Record<string, string> {
  const txt: Record<string, string> = {};
  const matches = line.match(/(?:^|\s)([A-Za-z0-9_-]+)=((?:\\.|[^\s])*)/g) ?? [];

  for (const entry of matches) {
    const trimmed = entry.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    txt[key] = decodeDnsSdValue(value);
  }

  return txt;
}

async function resolveService(
  instanceName: string,
  serviceType: string
): Promise<ResolvedService | null> {
  const output = await runDnsSd(['-L', instanceName, serviceType, 'local.'], 2000);
  const lines = output.split(/\r?\n/);
  let hostName: string | undefined;
  let port: number | undefined;
  let txt: Record<string, string> = {};

  for (const line of lines) {
    const endpointMatch = /can be reached at\s+(.+?):(\d+)/.exec(line);
    if (endpointMatch) {
      hostName = endpointMatch[1].trim();
      port = Number(endpointMatch[2]);
      continue;
    }

    if (line.includes('=')) {
      txt = { ...txt, ...parseTxtRecord(line) };
    }
  }

  if (!hostName) {
    return null;
  }

  const host = await resolveHostToIp(hostName);
  if (!host) {
    return null;
  }

  return {
    instanceName,
    hostName,
    host,
    port,
    txt,
  };
}

async function resolveHostToIp(hostName: string): Promise<string | undefined> {
  const output = await runDnsSd(['-G', 'v4', hostName], 2000);
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const match = /\s((?:\d{1,3}\.){3}\d{1,3})\s+\d+\s*$/.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

export async function discoverGoogleTvDevices(): Promise<DiscoveredDevice[]> {
  const [remoteInstances, castInstances, adbConnectInstances, adbPairInstances] = await Promise.all(
    [
      browseServiceInstances('_androidtvremote2._tcp', 1500).catch(() => []),
      browseServiceInstances('_googlecast._tcp').catch(() => []),
      browseServiceInstances('_adb-tls-connect._tcp', 1500).catch(() => []),
      browseServiceInstances('_adb-tls-pairing._tcp', 1500).catch(() => []),
    ]
  );

  const [remoteServices, castServices, adbConnectServices, adbPairServices] = await Promise.all([
    Promise.all(
      remoteInstances.map((instance) => resolveService(instance, '_androidtvremote2._tcp'))
    ),
    Promise.all(castInstances.map((instance) => resolveService(instance, '_googlecast._tcp'))),
    Promise.all(
      adbConnectInstances.map((instance) => resolveService(instance, '_adb-tls-connect._tcp'))
    ),
    Promise.all(
      adbPairInstances.map((instance) => resolveService(instance, '_adb-tls-pairing._tcp'))
    ),
  ]);

  const remoteByHost = new Map<string, ResolvedService>();
  const connectByHost = new Map<string, ResolvedService>();
  const pairingByHost = new Map<string, ResolvedService>();

  for (const service of remoteServices) {
    if (service?.host) {
      remoteByHost.set(service.host, service);
    }
  }

  for (const service of adbConnectServices) {
    if (service?.host) {
      connectByHost.set(service.host, service);
    }
  }

  for (const service of adbPairServices) {
    if (service?.host) {
      pairingByHost.set(service.host, service);
    }
  }

  const devices = new Map<string, DiscoveredDevice>();

  for (const service of remoteServices) {
    if (!service?.host) {
      continue;
    }

    const name = decodeDnsSdValue(service.instanceName);
    devices.set(service.host, {
      id: buildDiscoveredId(service.host, name),
      name,
      host: service.host,
      remotePort: service.port,
      pairingPort: 6467,
      macAddress: service.txt.bt,
      source: 'androidtvremote',
    });
  }

  for (const service of castServices) {
    if (!service?.host) {
      continue;
    }

    const existing = devices.get(service.host);
    const remoteService = remoteByHost.get(service.host);
    const connectService = connectByHost.get(service.host);
    const pairService = pairingByHost.get(service.host);
    const name = service.txt.fn || service.instanceName;

    devices.set(service.host, {
      id: existing?.id ?? buildDiscoveredId(service.host, name),
      name: existing?.name ?? name,
      host: service.host,
      remotePort: existing?.remotePort ?? remoteService?.port,
      adbPort: connectService?.port,
      pairingPort: existing?.pairingPort ?? pairService?.port,
      macAddress: existing?.macAddress ?? remoteService?.txt.bt,
      model: service.txt.md || existing?.model,
      source: existing?.source ?? (connectService || pairService ? 'adb' : 'googlecast'),
    });
  }

  return [...devices.values()].sort((left, right) => left.name.localeCompare(right.name));
}
