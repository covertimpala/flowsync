import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx
from sqlmodel import Session, select

from ..models import OAuthAccount


class OAuthException(Exception):
    pass


@dataclass
class DeviceFlowConfig:
    device_code_url: str
    token_url: str
    client_id: str
    scope: str


@dataclass
class DeviceCodeInfo:
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class OAuthDeviceFlow:
    """OAuth 2.0 Device Authorization Grant (RFC 8628) — the user visits a
    short URL on any device and types a short code, instead of this
    (browser-less) backend needing a redirect URI. Both Google and
    Microsoft support this for installed/public clients."""

    def __init__(self, config: DeviceFlowConfig, provider: str):
        self.config = config
        self.provider = provider

    async def request_code(self) -> DeviceCodeInfo:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                self.config.device_code_url,
                data={"client_id": self.config.client_id, "scope": self.config.scope},
            )
        if res.status_code != 200:
            raise OAuthException(f"Device code request failed: {res.text}")
        data = res.json()
        return DeviceCodeInfo(
            device_code=data["device_code"],
            user_code=data["user_code"],
            verification_uri=data.get("verification_uri") or data.get("verification_url"),
            expires_in=data["expires_in"],
            interval=data.get("interval", 5),
        )

    async def poll_for_tokens(self, session: Session, code: DeviceCodeInfo) -> OAuthAccount:
        deadline = datetime.now() + timedelta(seconds=code.expires_in)
        interval = code.interval

        async with httpx.AsyncClient() as client:
            while datetime.now() < deadline:
                await asyncio.sleep(interval)

                res = await client.post(
                    self.config.token_url,
                    data={
                        "client_id": self.config.client_id,
                        "device_code": code.device_code,
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    },
                )
                data = res.json()

                if res.status_code == 200:
                    account = session.get(OAuthAccount, self.provider) or OAuthAccount(
                        provider=self.provider, client_id=self.config.client_id,
                        access_token="", expires_at=datetime.now(),
                    )
                    account.client_id = self.config.client_id
                    account.access_token = data["access_token"]
                    account.refresh_token = data.get("refresh_token", account.refresh_token)
                    account.expires_at = datetime.now() + timedelta(seconds=data["expires_in"])
                    session.add(account)
                    session.commit()
                    session.refresh(account)
                    return account

                error = data.get("error")
                if error == "authorization_pending":
                    continue
                if error == "slow_down":
                    interval += 5
                    continue
                raise OAuthException(f"Authorization failed: {data.get('error_description', error)}")

        raise OAuthException("Code expired before it was approved — try connecting again.")

    async def valid_access_token(self, session: Session) -> str | None:
        account = session.exec(select(OAuthAccount).where(OAuthAccount.provider == self.provider)).first()
        if account is None:
            return None
        if datetime.now() < account.expires_at - timedelta(minutes=1):
            return account.access_token
        if not account.refresh_token:
            return None

        async with httpx.AsyncClient() as client:
            res = await client.post(
                self.config.token_url,
                data={
                    "client_id": self.config.client_id,
                    "refresh_token": account.refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        if res.status_code != 200:
            return None
        data = res.json()
        account.access_token = data["access_token"]
        account.refresh_token = data.get("refresh_token", account.refresh_token)
        account.expires_at = datetime.now() + timedelta(seconds=data["expires_in"])
        session.add(account)
        session.commit()
        return account.access_token

    def is_connected(self, session: Session) -> bool:
        return session.get(OAuthAccount, self.provider) is not None

    def disconnect(self, session: Session) -> None:
        account = session.get(OAuthAccount, self.provider)
        if account:
            session.delete(account)
            session.commit()
