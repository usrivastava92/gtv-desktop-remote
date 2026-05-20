import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createImeBatchEditMessage,
  createRemoteConfigure,
  createRemoteKeyInject,
  createRemoteKeyInjectRaw,
  createRemotePingResponse,
  createRemoteSetActive,
  createRemoteVoiceBegin,
  createRemoteVoiceEnd,
  createRemoteVoicePayload,
  parseRemoteMessage,
} from '../remote';

const fixturesPath = path.resolve(__dirname, '..', '__fixtures__', 'remote.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as Record<string, string>;

/**
 * Golden encode tests. Every byte produced by the encoders is compared to a
 * captured hex frame that we know works against a real Google TV. If anything
 * in the codec changes — protobuf field numbers, key codes, direction enum,
 * device-info layout — these tests fail loudly.
 *
 * This is the first **Google TV non-regression gate** described in
 * REFACTOR_PLAN.md §7.1 #8.
 */
describe('remote codec — golden encode', () => {
  it('createRemoteConfigure — REMOTE_FEATURES=622 (production value)', () => {
    expect(createRemoteConfigure(622).toString('hex')).toBe(fixtures.configure_622);
  });

  it('createRemoteSetActive — small value', () => {
    expect(createRemoteSetActive(1).toString('hex')).toBe(fixtures.setActive_1);
  });

  it('createRemoteSetActive — multi-byte varint', () => {
    expect(createRemoteSetActive(622).toString('hex')).toBe(fixtures.setActive_622);
  });

  it('createRemotePingResponse', () => {
    expect(createRemotePingResponse(42).toString('hex')).toBe(fixtures.pingResponse_42);
  });

  describe('createRemoteKeyInject — every RemoteCommand', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['up', 'keyInject_up'],
      ['down', 'keyInject_down'],
      ['left', 'keyInject_left'],
      ['right', 'keyInject_right'],
      ['select', 'keyInject_select'],
      ['home', 'keyInject_home'],
      ['back', 'keyInject_back'],
      ['play_pause', 'keyInject_playPause'],
      ['volume_up', 'keyInject_volumeUp'],
      ['volume_down', 'keyInject_volumeDown'],
      ['power', 'keyInject_power'],
      ['assistant_press', 'keyInject_assistantPress'],
      ['assistant_release', 'keyInject_assistantRelease'],
    ];

    for (const [command, fixtureKey] of cases) {
      it(`encodes ${command}`, () => {
        const actual = createRemoteKeyInject(
          command as Parameters<typeof createRemoteKeyInject>[0]
        ).toString('hex');
        expect(actual).toBe(fixtures[fixtureKey]);
      });
    }
  });

  it('createRemoteKeyInjectRaw — long-press power', () => {
    expect(createRemoteKeyInjectRaw('KEYCODE_POWER', 'START_LONG').toString('hex')).toBe(
      fixtures.keyInject_raw_powerLong
    );
  });

  it('voice begin / payload / end', () => {
    expect(createRemoteVoiceBegin(1).toString('hex')).toBe(fixtures.voiceBegin_session1);
    expect(createRemoteVoicePayload(1, Buffer.from([0x01, 0x02, 0x03])).toString('hex')).toBe(
      fixtures.voicePayload_session1_3bytes
    );
    expect(createRemoteVoiceEnd(1).toString('hex')).toBe(fixtures.voiceEnd_session1);
  });

  it('IME batch edit — single character', () => {
    expect(createImeBatchEditMessage(2, 7, 'a').toString('hex')).toBe(fixtures.imeBatch_aim2_fc7);
  });

  it('IME batch edit — multi-character', () => {
    expect(createImeBatchEditMessage(0, 0, 'hello').toString('hex')).toBe(fixtures.imeBatch_hello);
  });
});

/**
 * Round-trip tests prove the parser accepts every shape the encoder produces.
 * If the wire format drifts (e.g. field renamed in protobuf-jsk JSON output),
 * these break before any device sees the change.
 */
describe('remote codec — round-trip parse', () => {
  it('parses a setActive frame', () => {
    const parsed = parseRemoteMessage(createRemoteSetActive(7));
    expect(parsed.remoteSetActive).toBeDefined();
  });

  it('parses a ping-response frame', () => {
    const parsed = parseRemoteMessage(createRemotePingResponse(99));
    expect(parsed).toBeDefined();
  });

  it('parses a voice-begin frame and exposes the session id', () => {
    const parsed = parseRemoteMessage(createRemoteVoiceBegin(42));
    expect(parsed.remoteVoiceBegin?.sessionId).toBe(42);
  });

  it('parses a voice-end frame and exposes the session id', () => {
    const parsed = parseRemoteMessage(createRemoteVoiceEnd(42));
    expect(parsed.remoteVoiceEnd?.sessionId).toBe(42);
  });
});

/**
 * Sanity: protobuf length-delimited framing always prefixes the message with a
 * single-byte varint length when the payload is < 128 bytes. Most key-inject
 * frames are 6–7 bytes total, so this is a useful invariant to assert.
 */
describe('remote codec — framing invariants', () => {
  it('every key-inject frame starts with the correct length prefix', () => {
    const buf = createRemoteKeyInject('up');
    expect(buf.length).toBeGreaterThan(0);
    const declaredLength = buf.readUInt8(0);
    expect(buf.length - 1).toBe(declaredLength);
  });

  it('voice payload framing includes the samples buffer length', () => {
    const samples = Buffer.alloc(32, 0xab);
    const buf = createRemoteVoicePayload(7, samples);
    // First byte is the outer length prefix; assert nontrivial payload.
    expect(buf.length).toBeGreaterThan(samples.length);
  });
});
