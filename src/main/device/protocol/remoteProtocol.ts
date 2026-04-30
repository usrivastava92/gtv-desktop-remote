import os from 'node:os';

import protobuf from 'protobufjs';

import type { RemoteCommand } from '../../../shared/types';

const REMOTE_PROTO = String.raw`syntax = "proto3";
package remote;

message RemoteTextFieldStatus {
  int32 counter_field = 1;
  string value = 2;
  int32 start = 3;
  int32 end = 4;
  int32 int5 = 5;
  string label = 6;
}

message RemoteImeShowRequest {
  RemoteTextFieldStatus remote_text_field_status = 2;
}

message RemoteEditInfo {
  int32 insert = 2;
}

message RemoteImeBatchEdit {
  int32 ime_counter = 1;
  int32 field_counter = 2;
  repeated RemoteEditInfo edit_info = 3;
}

message RemoteAppInfo {
  string app_package = 12;
}

message RemoteImeKeyInject {
  RemoteAppInfo app_info = 1;
  RemoteTextFieldStatus text_field_status = 2;
}

enum RemoteKeyCode {
  KEYCODE_UNKNOWN = 0;
  KEYCODE_HOME = 3;
  KEYCODE_BACK = 4;
  KEYCODE_DPAD_UP = 19;
  KEYCODE_DPAD_DOWN = 20;
  KEYCODE_DPAD_LEFT = 21;
  KEYCODE_DPAD_RIGHT = 22;
  KEYCODE_DPAD_CENTER = 23;
  KEYCODE_VOLUME_UP = 24;
  KEYCODE_VOLUME_DOWN = 25;
  KEYCODE_POWER = 26;
  KEYCODE_MEDIA_PLAY_PAUSE = 85;
}

enum RemoteDirection {
  UNKNOWN_DIRECTION = 0;
  START_LONG = 1;
  END_LONG = 2;
  SHORT = 3;
}

message RemoteKeyInject {
  RemoteKeyCode key_code = 1;
  RemoteDirection direction = 2;
}

message RemotePingResponse {
  int32 val1 = 1;
}

message RemotePingRequest {
  int32 val1 = 1;
}

message RemoteSetActive {
  int32 active = 1;
}

message RemoteDeviceInfo {
  string model = 1;
  string vendor = 2;
  int32 unknown1 = 3;
  string unknown2 = 4;
  string package_name = 5;
  string app_version = 6;
}

message RemoteConfigure {
  int32 code1 = 1;
  RemoteDeviceInfo device_info = 2;
}

message RemoteStart {
  bool started = 1;
}

message RemoteSetVolumeLevel {
  uint32 volume_level = 7;
  bool volume_muted = 8;
}

message RemoteMessage {
  RemoteConfigure remote_configure = 1;
  RemoteSetActive remote_set_active = 2;
  RemotePingRequest remote_ping_request = 8;
  RemotePingResponse remote_ping_response = 9;
  RemoteKeyInject remote_key_inject = 10;
  RemoteImeKeyInject remote_ime_key_inject = 20;
  RemoteImeBatchEdit remote_ime_batch_edit = 21;
  RemoteImeShowRequest remote_ime_show_request = 22;
  RemoteStart remote_start = 40;
  RemoteSetVolumeLevel remote_set_volume_level = 50;
}`;

const remoteRoot = protobuf.parse(REMOTE_PROTO).root;
const remoteMessageType = remoteRoot.lookupType('remote.RemoteMessage');
const remoteKeyCode = remoteRoot.lookupEnum('remote.RemoteKeyCode').values;
const remoteDirection = remoteRoot.lookupEnum('remote.RemoteDirection').values;

type RemoteMessage = ReturnType<typeof decodeRemoteMessage>;

const keyMap: Record<RemoteCommand, keyof typeof remoteKeyCode> = {
  up: 'KEYCODE_DPAD_UP',
  down: 'KEYCODE_DPAD_DOWN',
  left: 'KEYCODE_DPAD_LEFT',
  right: 'KEYCODE_DPAD_RIGHT',
  select: 'KEYCODE_DPAD_CENTER',
  home: 'KEYCODE_HOME',
  back: 'KEYCODE_BACK',
  play_pause: 'KEYCODE_MEDIA_PLAY_PAUSE',
  volume_up: 'KEYCODE_VOLUME_UP',
  volume_down: 'KEYCODE_VOLUME_DOWN',
  power: 'KEYCODE_POWER',
};

function createRemoteMessage(payload: Record<string, unknown>): Buffer {
  const message = remoteMessageType.create(payload);
  return Buffer.from(remoteMessageType.encodeDelimited(message).finish());
}

function decodeRemoteMessage(buffer: Buffer) {
  return remoteMessageType.decodeDelimited(buffer).toJSON() as {
    remoteConfigure?: {
      code1?: number;
      deviceInfo?: { appVersion?: string; model?: string; vendor?: string };
    };
    remoteSetActive?: Record<string, unknown>;
    remotePingRequest?: { val1?: number };
    remoteImeKeyInject?: { appInfo?: { appPackage?: string } };
    remoteImeBatchEdit?: { fieldCounter?: number; imeCounter?: number };
    remoteSetVolumeLevel?: { volumeLevel?: number; volumeMuted?: boolean };
    remoteStart?: { started?: boolean };
  };
}

function getClientDeviceInfo() {
  return {
    appVersion: '1.0.0',
    model: os.hostname(),
    packageName: 'gtv-desktop-remote',
    unknown1: 1,
    unknown2: '1',
    vendor: `${os.type()} ${os.release()}`,
  };
}

export function parseRemoteMessage(buffer: Buffer): RemoteMessage {
  return decodeRemoteMessage(buffer);
}

export function createRemoteConfigure(features: number): Buffer {
  return createRemoteMessage({
    remoteConfigure: {
      code1: features,
      deviceInfo: getClientDeviceInfo(),
    },
  });
}

export function createRemoteSetActive(active: number): Buffer {
  return createRemoteMessage({
    remoteSetActive: { active },
  });
}

export function createRemotePingResponse(val1: number): Buffer {
  return createRemoteMessage({
    remotePingResponse: { val1 },
  });
}

export function createRemoteKeyInject(command: RemoteCommand): Buffer {
  return createRemoteMessage({
    remoteKeyInject: {
      direction: remoteDirection.SHORT,
      keyCode: remoteKeyCode[keyMap[command]],
    },
  });
}

const REMOTE_IME_PROTO = String.raw`syntax = "proto3";
package remote;

message RemoteImeObject {
  int32 start = 1;
  int32 end = 2;
  string value = 3;
}

message RemoteEditInfo {
  int32 insert = 1;
  RemoteImeObject text_field_status = 2;
}

message RemoteImeBatchEdit {
  int32 ime_counter = 1;
  int32 field_counter = 2;
  repeated RemoteEditInfo edit_info = 3;
}

message RemoteMessage {
  RemoteImeBatchEdit remote_ime_batch_edit = 21;
}`;

const imeRoot = protobuf.parse(REMOTE_IME_PROTO).root;
const imeRemoteMessageType = imeRoot.lookupType('remote.RemoteMessage');

export function createImeBatchEditMessage(
  imeCounter: number,
  fieldCounter: number,
  text: string
): Buffer {
  const cursorIndex = text.length - 1;
  const message = imeRemoteMessageType.create({
    remoteImeBatchEdit: {
      editInfo: [
        {
          insert: 1,
          textFieldStatus: {
            end: cursorIndex,
            start: cursorIndex,
            value: text,
          },
        },
      ],
      fieldCounter,
      imeCounter,
    },
  });

  return Buffer.from(imeRemoteMessageType.encodeDelimited(message).finish());
}
