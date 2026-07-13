from uuid import uuid4

from sqlalchemy import inspect

from app.db.session import SessionLocal, engine
from app.models import Campaign
from app.scripts.seed_pound_experiment import main as seed_pound_experiment


def _campaign_payload(*, slug: str | None = None) -> dict:
    unique_slug = slug or f"campaign-{uuid4().hex[:10]}"
    return {
        "name": "The £1 Experiment",
        "slug": unique_slug,
        "core_question": "Would you give a stranger £1?",
        "description": "A transparent internet social experiment.",
        "currency": "GBP",
        "target_amount_minor": 100,
        "target_reach": 10000000,
        "status": "draft",
        "content_rules_json": {"rules": ["no fake statistics"]},
        "target_platforms_json": ["tiktok", "instagram"],
    }


def _variant_payload(*, tracking_code: str | None = None) -> dict:
    return {
        "hook_type": "direct-ask",
        "visual_type": "talking-head",
        "tone": "curious",
        "call_to_action": "Send £1 if you would take part.",
        "video_length_seconds": 15,
        "voiceover_enabled": True,
        "text_density": "low",
        "tracking_code": tracking_code or f"trk-{uuid4().hex[:10]}",
        "experiment_config_json": {"audience": "broad"},
    }


def _create_campaign(client, *, slug: str | None = None) -> dict:
    response = client.post("/api/campaigns", json=_campaign_payload(slug=slug))
    assert response.status_code == 200
    return response.json()


def test_campaign_creation(client):
    response = client.post("/api/campaigns", json=_campaign_payload())
    assert response.status_code == 200
    payload = response.json()
    assert payload["currency"] == "GBP"
    assert payload["target_amount_minor"] == 100
    assert payload["target_reach"] == 10000000
    assert payload["content_rules_json"] == {"rules": ["no fake statistics"]}


def test_duplicate_slug_rejected(client):
    payload = _campaign_payload(slug=f"dupe-{uuid4().hex[:8]}")
    first = client.post("/api/campaigns", json=payload)
    second = client.post("/api/campaigns", json=payload)
    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == "Campaign slug already exists"


def test_campaign_listing(client):
    created = _create_campaign(client)
    response = client.get("/api/campaigns")
    assert response.status_code == 200
    items = response.json()["items"]
    assert any(item["id"] == created["id"] for item in items)


def test_campaign_retrieval(client):
    created = _create_campaign(client)
    response = client.get(f"/api/campaigns/{created['id']}")
    assert response.status_code == 200
    assert response.json()["slug"] == created["slug"]


def test_campaign_update(client):
    created = _create_campaign(client)
    response = client.patch(
        f"/api/campaigns/{created['id']}",
        json={"status": "active", "description": "Updated experiment description."},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "active"
    assert payload["description"] == "Updated experiment description."


def test_variant_creation(client):
    created = _create_campaign(client)
    response = client.post(f"/api/campaigns/{created['id']}/variants", json=_variant_payload())
    assert response.status_code == 200
    payload = response.json()
    assert payload["campaign_id"] == created["id"]
    assert payload["video_length_seconds"] == 15


def test_duplicate_tracking_code_rejected(client):
    created = _create_campaign(client)
    payload = _variant_payload(tracking_code=f"track-{uuid4().hex[:8]}")
    first = client.post(f"/api/campaigns/{created['id']}/variants", json=payload)
    second = client.post(f"/api/campaigns/{created['id']}/variants", json=payload)
    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == "Creative variant tracking code already exists"


def test_variant_campaign_ownership(client):
    campaign_a = _create_campaign(client)
    campaign_b = _create_campaign(client)
    variant_a = client.post(f"/api/campaigns/{campaign_a['id']}/variants", json=_variant_payload()).json()
    client.post(f"/api/campaigns/{campaign_b['id']}/variants", json=_variant_payload())

    response = client.get(f"/api/campaigns/{campaign_a['id']}/variants")
    assert response.status_code == 200
    variants = response.json()
    assert any(item["id"] == variant_a["id"] for item in variants)
    assert all(item["campaign_id"] == campaign_a["id"] for item in variants)


def test_campaign_schema_metadata_includes_new_tables():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert {"campaigns", "creative_variants"} <= tables
    pipeline_run_columns = {column["name"] for column in inspector.get_columns("pipeline_runs")}
    assert {"campaign_id", "creative_variant_id"} <= pipeline_run_columns


def test_seed_pound_experiment_is_idempotent():
    seed_pound_experiment()
    seed_pound_experiment()

    with SessionLocal() as db:
        campaigns = db.query(Campaign).filter(Campaign.slug == "the-one-pound-experiment").all()
        assert len(campaigns) == 1
        campaign = campaigns[0]
        assert campaign.name == "The £1 Experiment"
        assert campaign.target_platforms_json == ["tiktok", "instagram", "youtube"]
