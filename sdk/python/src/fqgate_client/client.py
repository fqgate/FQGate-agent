from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .discovery import ConnectionConfig, discover_connection
from .errors import ApiError

MarketSecurity = Mapping[str, str]
KlineInterval = Literal["1m", "5m", "15m", "30m", "60m", "120m", "day", "week", "month", "quarter", "year"]
KlineAdjustment = Literal["", "forward", "backward"]


class Client:
    def __init__(self, connection: ConnectionConfig, *, timeout: float = 30.0) -> None:
        self.connection = connection
        self.timeout = timeout

    @classmethod
    def discover(
        cls,
        config_path: str | None = None,
        *,
        timeout: float = 30.0,
    ) -> "Client":
        return cls(discover_connection(config_path), timeout=timeout)

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
        *,
        query: Mapping[str, Any] | None = None,
    ) -> Any:
        url = self.connection.base_url.rstrip("/") + "/" + path.lstrip("/")
        if query:
            encoded = urlencode({key: value for key, value in query.items() if value is not None}, doseq=True)
            if encoded:
                url += "?" + encoded
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json", "User-Agent": "fqgate-client-python/1.0.0"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=body, method=method.upper(), headers=headers)

        try:
            with urlopen(request, timeout=self.timeout) as response:
                status = response.status
                raw = response.read()
        except HTTPError as error:
            self._raise_api_error(
                error.read(),
                status=error.code,
                request_id=error.headers.get("X-Request-Id", ""),
                fallback=str(error),
            )
        except URLError as error:
            raise ApiError(f"无法连接本机 FQGate：{error.reason}", code="connection_error") from error

        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError("FQGate 返回了无法解析的 JSON。", code="invalid_response", status=status) from error

    def health(self) -> dict[str, Any]:
        return self.request("GET", "/v1/market/health")

    def openapi(self) -> dict[str, Any]:
        return self.request("GET", "/openapi.json")

    def search(self, pattern: str, *, market: str | None = None) -> Any:
        payload: dict[str, Any] = {"pattern": pattern}
        if market is not None:
            payload["need_market"] = market
        return self.request("POST", "/v1/market/catalog/search-symbols", payload)

    def quote(self, securities: Sequence[MarketSecurity], fields: Sequence[int]) -> Any:
        return self.request(
            "POST",
            "/v1/market/realtime/quote",
            {"securities": list(securities), "fields": list(fields)},
        )

    def market_data(
        self,
        securities: Sequence[MarketSecurity],
        *,
        market_group: str = "cn",
        query_key: str | None = None,
    ) -> Any:
        allowed = {"block", "cn", "us", "hk", "uk", "bond", "fund", "future", "forex", "index"}
        if market_group not in allowed:
            raise ValueError(f"不支持的 market_group：{market_group}")
        payload: dict[str, Any] = {"securities": list(securities)}
        if query_key is not None:
            payload["query_key"] = query_key
        return self.request("POST", f"/v1/market/realtime/{market_group}", payload)

    def klines(
        self,
        market: str,
        code: str,
        *,
        count: int | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: KlineAdjustment | None = None,
        interval: KlineInterval | None = None,
    ) -> Any:
        payload = _optional_payload(
            market=market,
            code=code,
            count=count,
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
            interval=interval,
        )
        return self.request("POST", "/v1/market/history/klines", payload)

    def intraday(self, market: str, code: str) -> Any:
        return self.request("POST", "/v1/market/history/intraday", {"market": market, "code": code})

    def level2(
        self,
        market: str,
        code: str,
        *,
        kind: Literal["orders", "transactions", "buy-cancellations", "sell-cancellations"] = "orders",
        fields: Sequence[str | int],
        range: Mapping[str, Any] | str | None = None,
        semantic: bool = True,
        trade_date: str | None = None,
        require_data: bool | None = None,
    ) -> Any:
        allowed = {"orders", "transactions", "buy-cancellations", "sell-cancellations"}
        if kind not in allowed:
            raise ValueError(f"不支持的 Level-2 kind：{kind}")
        payload = _optional_payload(
            market=market,
            code=code,
            fields=list(fields),
            range=range,
            semantic=semantic,
            trade_date=trade_date,
            require_data=require_data,
        )
        return self.request("POST", f"/v1/market/level2/{kind}", payload)

    @staticmethod
    def _raise_api_error(raw: bytes, *, status: int, request_id: str, fallback: str) -> None:
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(fallback, status=status, request_id=request_id) from None
        if isinstance(value, dict):
            code = str(value.get("code") or "api_error")
            message = str(value.get("message") or fallback)
            raise ApiError(message, code=code, status=status, request_id=request_id, details=value.get("details"))
        raise ApiError(fallback, status=status, request_id=request_id)


def _optional_payload(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}
