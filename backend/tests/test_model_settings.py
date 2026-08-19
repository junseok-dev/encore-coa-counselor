import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langsmith import tracing_context
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import AppSetting
from app.services import model_settings, openai_service


class FakeCompletions:
    def __init__(self):
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return FakeStream()
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="테스트 답변"))],
            usage=SimpleNamespace(total_tokens=10),
        )


class FakeStream:
    def __init__(self):
        self._chunks = iter(
            [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="테스트"))])]
        )

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class ModelSettingPersistenceTest(unittest.TestCase):
    def test_changed_model_is_read_immediately_from_database(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        AppSetting.__table__.create(engine)
        test_session = sessionmaker(bind=engine)

        with test_session() as db:
            model_settings.set_active_model(db, "gpt-5.4-mini")

        with patch.object(model_settings, "SessionLocal", test_session):
            self.assertEqual("gpt-5.4-mini", model_settings.get_active_model())

    def test_changed_embedding_model_is_read_immediately_from_database(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        AppSetting.__table__.create(engine)
        test_session = sessionmaker(bind=engine)

        with test_session() as db:
            model_settings.set_active_embedding_model(db, "text-embedding-3-small")

        with patch.object(model_settings, "SessionLocal", test_session):
            self.assertEqual("text-embedding-3-small", model_settings.get_active_embedding_model())


class ActiveModelRequestTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.completions = FakeCompletions()
        self.client = SimpleNamespace(
            chat=SimpleNamespace(completions=self.completions),
        )

    async def test_standard_answer_uses_active_model(self):
        with (
            tracing_context(enabled=False),
            patch.object(openai_service, "client", self.client),
            patch.object(openai_service, "get_active_model", return_value="gpt-5.4-mini"),
        ):
            await openai_service.get_ai_response("질문", "문맥")

        self.assertEqual("gpt-5.4-mini", self.completions.calls[0]["model"])

    async def test_streaming_answer_uses_active_model(self):
        with (
            tracing_context(enabled=False),
            patch.object(openai_service, "client", self.client),
            patch.object(openai_service, "get_active_model", return_value="gpt-5.4-mini"),
        ):
            chunks = [
                chunk
                async for chunk in openai_service.stream_ai_response("질문", "문맥")
            ]

        self.assertEqual(["테스트"], chunks)
        self.assertEqual("gpt-5.4-mini", self.completions.calls[0]["model"])


if __name__ == "__main__":
    unittest.main()
