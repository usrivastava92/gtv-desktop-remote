#!/usr/bin/env python3

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

from androidtvremote2 import (AndroidTVRemote, CannotConnect, ConnectionClosed,
                              InvalidAuth)

LOGGER = logging.getLogger("androidtv_remote_bridge")


class BridgeError(Exception):
    pass


class AndroidTvRemoteBridge:
    def __init__(self, state_dir: Path, client_name: str) -> None:
        self._state_dir = state_dir
        self._client_name = client_name
        self._state_dir.mkdir(parents=True, exist_ok=True)
        self._remotes: dict[str, AndroidTVRemote] = {}
        self._connected_hosts: set[str] = set()

    def _files_for_host(self, host: str) -> tuple[Path, Path]:
        host_key = host.replace(":", "_").replace("/", "_")
        certfile = self._state_dir / f"{host_key}.cert.pem"
        keyfile = self._state_dir / f"{host_key}.key.pem"
        return certfile, keyfile

    def _get_remote(self, host: str) -> AndroidTVRemote:
        remote = self._remotes.get(host)
        if remote is None:
          certfile, keyfile = self._files_for_host(host)
          remote = AndroidTVRemote(
              client_name=self._client_name,
              certfile=str(certfile),
              keyfile=str(keyfile),
              host=host,
          )
          self._remotes[host] = remote
        return remote

    async def _ensure_connected(self, host: str) -> AndroidTVRemote:
        remote = self._get_remote(host)
        if host in self._connected_hosts:
            return remote

        await remote.async_connect()
        self._connected_hosts.add(host)
        return remote

    async def start_pairing(self, host: str) -> dict[str, Any]:
        remote = self._get_remote(host)
        await remote.async_generate_cert_if_missing()
        name, mac = await remote.async_get_name_and_mac()
        await remote.async_start_pairing()
        return {"name": name, "mac": mac}

    async def finish_pairing(self, host: str, code: str) -> dict[str, Any]:
        remote = self._get_remote(host)
        await remote.async_finish_pairing(code)
        self._connected_hosts.discard(host)
        return {}

    async def connect(self, host: str) -> dict[str, Any]:
        remote = await self._ensure_connected(host)
        device_info = remote.device_info
        return {
            "name": getattr(device_info, "model", None) or host,
            "mac": None,
            "is_on": remote.is_on,
            "current_app": remote.current_app,
        }

    async def disconnect(self, host: str) -> dict[str, Any]:
        remote = self._remotes.get(host)
        if remote:
            remote.disconnect()
        self._connected_hosts.discard(host)
        return {}

    async def send_command(self, host: str, command: str) -> dict[str, Any]:
        remote = await self._ensure_connected(host)
        remote.send_key_command(command)
        return {}

    async def send_text(self, host: str, text: str) -> dict[str, Any]:
        remote = await self._ensure_connected(host)
        remote.send_text(text)
        return {}

    async def handle(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        host = str(payload.get("host", "")).strip()
        if not host:
            raise BridgeError("Missing host")

        try:
            if action == "start_pairing":
                return await self.start_pairing(host)
            if action == "finish_pairing":
                return await self.finish_pairing(host, str(payload.get("code", "")).strip())
            if action == "connect":
                return await self.connect(host)
            if action == "disconnect":
                return await self.disconnect(host)
            if action == "send_command":
                return await self.send_command(host, str(payload.get("command", "")).strip())
            if action == "send_text":
                return await self.send_text(host, str(payload.get("text", "")))
        except InvalidAuth as exc:
            raise BridgeError(f"Invalid authentication: {exc}") from exc
        except CannotConnect as exc:
            raise BridgeError(f"Cannot connect to device: {exc}") from exc
        except ConnectionClosed as exc:
            self._connected_hosts.discard(host)
            raise BridgeError(f"Connection closed: {exc}") from exc

        raise BridgeError(f"Unsupported action: {action}")


async def _async_readline() -> str:
    return await asyncio.to_thread(sys.stdin.readline)


async def _serve(state_dir: Path, client_name: str) -> None:
    bridge = AndroidTvRemoteBridge(state_dir, client_name)

    while True:
        line = await _async_readline()
        if not line:
            break

        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = int(request["id"])
            action = str(request["action"])
            payload = dict(request.get("payload", {}))
            result = await bridge.handle(action, payload)
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as exc:  # noqa: BLE001
            request_id = request.get("id", -1) if isinstance(request, dict) else -1
            LOGGER.exception("Bridge request failed")
            response = {"id": request_id, "ok": False, "error": str(exc)}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdio", action="store_true")
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--client-name", default="GTV Desktop Remote")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, stream=sys.stderr)

    if not args.stdio:
        raise SystemExit("Only --stdio mode is supported")

    asyncio.run(_serve(Path(args.state_dir), args.client_name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())