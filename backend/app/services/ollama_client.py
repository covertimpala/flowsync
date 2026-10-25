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

    async def generate(self, prompt: str, system: str | None = None) -> str:
        body = {"model": self.model, "prompt": prompt, "stream": False}
        if system:
            body["system"] = system

        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(f"{self.host}/api/generate", json=body)
        if res.status_code != 200:
            raise OllamaException(f"Ollama returned {res.status_code}: {res.text}")
        return res.json().get("response", "")
