import time
from .base import BaseProvider, ProviderConfig, ProviderStatus

class EchoProvider(BaseProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self.status = ProviderStatus.ONLINE

    async def chat_completion(self, messages, model=None, stream=False, **kwargs):
        last = messages[-1]["content"] if messages else "ok"
        return {
            "id": f"echo-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "echo",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": f"Echo: {last}"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }

    async def check_health(self):
        self.status = ProviderStatus.ONLINE
        return True
