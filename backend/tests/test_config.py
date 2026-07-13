from app.config import Settings
from app.services.system_service import check_redis_readiness


def test_app_env_alias_populates_environment():
    settings = Settings(APP_ENV="staging")

    assert settings.environment == "staging"


def test_environment_alias_still_supported():
    settings = Settings(ENVIRONMENT="production")

    assert settings.environment == "production"


def test_app_env_takes_precedence_over_environment():
    settings = Settings(APP_ENV="staging", ENVIRONMENT="production")

    assert settings.environment == "staging"


def test_environment_defaults_when_no_alias_is_set(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings = Settings()

    assert settings.environment == "development"


def test_normalized_database_url_accepts_legacy_postgres_scheme():
    settings = Settings(DATABASE_URL="postgres://user:pass@db.example.com:5432/app?sslmode=require")

    assert settings.normalized_database_url() == "postgresql+psycopg://user:pass@db.example.com:5432/app?sslmode=require"


def test_normalized_database_url_accepts_render_postgres_scheme():
    settings = Settings(DATABASE_URL="postgresql://user:pass@db.example.com:5432/app?sslmode=require")

    assert settings.normalized_database_url() == "postgresql+psycopg://user:pass@db.example.com:5432/app?sslmode=require"


def test_normalized_database_url_keeps_existing_psycopg_scheme():
    settings = Settings(DATABASE_URL="postgresql+psycopg://user:pass@db.example.com:5432/app")

    assert settings.normalized_database_url() == "postgresql+psycopg://user:pass@db.example.com:5432/app"


def test_normalized_database_url_leaves_unsupported_scheme_unchanged():
    settings = Settings(DATABASE_URL="mysql://user:pass@db.example.com:3306/app")

    assert settings.normalized_database_url() == "mysql://user:pass@db.example.com:3306/app"


def test_redis_url_is_optional_for_settings(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    settings = Settings(DATABASE_URL="sqlite:///./test.db")

    assert settings.redis_url == ""


def test_redis_health_is_disabled_when_url_not_configured(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    settings = Settings(DATABASE_URL="sqlite:///./test.db")

    result = check_redis_readiness(settings)

    assert result["status"] == "disabled"


def test_redis_health_is_ok_when_configured_and_reachable(monkeypatch):
    settings = Settings(DATABASE_URL="sqlite:///./test.db", REDIS_URL="redis://cache.example.com:6379/0")

    class FakeRedisClient:
        def ping(self):
            return True

    monkeypatch.setattr("app.services.system_service.Redis.from_url", lambda _url: FakeRedisClient())

    result = check_redis_readiness(settings)

    assert result["status"] == "ok"
    assert "reachable" in result["detail"].lower()


def test_redis_health_is_error_when_configured_but_unreachable(monkeypatch):
    settings = Settings(DATABASE_URL="sqlite:///./test.db", REDIS_URL="redis://cache.example.com:6379/0")

    class FakeRedisError(RuntimeError):
        pass

    class FakeRedisClient:
        def ping(self):
            raise FakeRedisError("refused")

    monkeypatch.setattr("app.services.system_service.Redis.from_url", lambda _url: FakeRedisClient())

    result = check_redis_readiness(settings)

    assert result["status"] == "error"
    assert "redis unavailable" in result["detail"].lower()
