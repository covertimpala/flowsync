import httpx


class OllamaException(Exception):
    pass


class OllamaClient:
    """Thin wrapper around a local Ollama server's REST API
    (https://github.com/ollama/ollama/blob/main/docs/api.md). Nothing in
    FlowSync ever leaves the device for this: `host` defaults to Ollama's
    own loopback address, and the model only ever sees data already in the
    local database."""

    def __init__(self, host: str = "http://localhost:11434", model: str = "llama3.2"):
        self.host = host
        self.model = model

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                res = await client.get(f"{self.host}/api/tags")
                return res.status_code == 200
        except httpx.HTTPError:
            return False

    async def generate(self, prompt: str, system: str | None = None, think: bool = False) -> str:
        # think=False: every caller here wants pure structured JSON back,
        # not visible chain-of-thought — and for a hybrid reasoning model
        # (Qwen3 and similar), leaving thinking on is actively harmful for
        # this use case: Ollama caps total output tokens per request, the
        # model can burn the whole budget on hidden reasoning for a
        # multi-part instruction, and `response` comes back empty
        # (`done_reason: "length"`) with nothing to parse. Models that
        # don't support the "think" field just ignore it.
        body = {"model": self.model, "prompt": prompt, "stream": False, "think": think}
        if system:
            body["system"] = system

        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(f"{self.host}/api/generate", json=body)
        if res.status_code != 200:
            raise OllamaException(f"Ollama returned {res.status_code}: {res.text}")
        return res.json().get("response", "")
