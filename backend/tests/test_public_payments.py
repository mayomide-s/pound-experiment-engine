import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import stripe

from app.config import get_settings
from app.db.session import SessionLocal
from app.models import Campaign, CheckoutSessionRecord
from app.services.payment_service import (
    EXPERIMENT_TYPE,
    CheckoutSessionVerificationError,
    _ensure_checkout_session_matches_campaign,
    _get_metadata,
    process_checkout_session_completed,
    resolve_public_experiment_campaign,
)


def _campaign_payload(slug: str = "the-one-pound-experiment") -> dict:
    return {
        "name": "The £1 Experiment",
        "slug": slug,
        "core_question": "Would you give a stranger £1?",
        "description": "A transparent internet social experiment.",
        "currency": "GBP",
        "target_amount_minor": 100,
        "target_reach": 10000000,
        "status": "active",
        "content_rules_json": {"rules": ["no fake statistics"]},
        "target_platforms_json": ["tiktok", "instagram", "youtube"],
    }


class FakeStripeSession(SimpleNamespace):
    def __getitem__(self, key):
        return getattr(self, key)


class FakeStripeMetadata:
    def __init__(self, payload):
        self.payload = payload

    def to_dict_recursive(self):
        return dict(self.payload)


class FakeStripeMetadataInvalid:
    def to_dict_recursive(self):
        return ["not", "a", "dict"]


class FakeStripeClient:
    def __init__(self, *, construct_stripe_event: bool = False):
        self.created_payloads: list[dict] = []
        self.retrieve_payloads: dict[str, FakeStripeSession] = {}
        self.valid_secret = "whsec_test"
        self.construct_stripe_event = construct_stripe_event

        class FakeSessionAPI:
            def __init__(api_self, outer: "FakeStripeClient"):
                api_self.outer = outer

            def create(api_self, **kwargs):
                api_self.outer.created_payloads.append(kwargs)
                session_id = f"cs_test_{uuid4().hex[:10]}"
                session = FakeStripeSession(
                    id=session_id,
                    url=f"https://checkout.stripe.test/session/{session_id}",
                    payment_status="unpaid",
                    status="open",
                    currency=kwargs["line_items"][0]["price_data"]["currency"],
                    amount_total=kwargs["line_items"][0]["price_data"]["unit_amount"],
                    mode=kwargs["mode"],
                    metadata=kwargs["metadata"],
                )
                api_self.outer.retrieve_payloads[session.id] = session
                return session

            def retrieve(api_self, session_id: str):
                return api_self.outer.retrieve_payloads[session_id]

        class FakeWebhookAPI:
            def __init__(api_self, outer: "FakeStripeClient"):
                api_self.outer = outer

            def construct_event(api_self, payload: bytes, sig_header: str, secret: str):
                if sig_header != "valid-signature" or secret != api_self.outer.valid_secret:
                    raise ValueError("invalid signature")
                event = json.loads(payload.decode("utf-8"))
                if api_self.outer.construct_stripe_event:
                    return stripe.Event.construct_from(event, None)
                return event

        self.checkout = SimpleNamespace(Session=FakeSessionAPI(self))
        self.Webhook = FakeWebhookAPI(self)


def _build_stripe_event(event_id: str, session_payload: dict) -> stripe.Event:
    return stripe.Event.construct_from(
        {
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {"object": session_payload},
        },
        None,
    )


def _create_public_campaign(client, slug: str = "the-one-pound-experiment") -> dict:
    response = client.post("/api/campaigns", json=_campaign_payload(slug))
    if response.status_code == 200:
        return response.json()
    assert response.status_code == 409
    with SessionLocal() as db:
        campaign = db.query(Campaign).filter(Campaign.slug == slug).first()
        assert campaign is not None
        return {
            "id": campaign.id,
            "name": campaign.name,
            "slug": campaign.slug,
            "core_question": campaign.core_question,
            "description": campaign.description,
            "currency": campaign.currency,
            "target_amount_minor": campaign.target_amount_minor,
            "target_reach": campaign.target_reach,
            "status": campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status),
            "content_rules_json": campaign.content_rules_json,
            "target_platforms_json": campaign.target_platforms_json,
        }


def _enable_stripe(monkeypatch):
    monkeypatch.setenv("STRIPE_ENABLED", "true")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("PUBLIC_SITE_BASE_URL", "http://localhost:5173/")
    monkeypatch.setenv("PUBLIC_EXPERIMENT_CAMPAIGN_SLUG", "the-one-pound-experiment")
    get_settings.cache_clear()


def test_public_checkout_returns_503_when_stripe_disabled(client):
    response = client.post("/api/public/checkout-sessions", json={})
    assert response.status_code == 503
    assert response.json()["detail"] == "Stripe Checkout is currently unavailable."


def test_public_checkout_route_bypasses_private_access_only_for_public_endpoints(client, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()

    public_response = client.post("/api/public/checkout-sessions", json={})
    private_response = client.get("/api/campaigns")

    assert public_response.status_code == 503
    assert private_response.status_code == 401
    get_settings.cache_clear()


def test_resolves_public_campaign_by_configured_slug(client, monkeypatch):
    _enable_stripe(monkeypatch)
    _create_public_campaign(client)
    with SessionLocal() as db:
        campaign = resolve_public_experiment_campaign(db)
        assert campaign.slug == "the-one-pound-experiment"


def test_checkout_creation_uses_server_controlled_amount_currency_and_urls(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)

    response = client.post("/api/public/checkout-sessions", json={"source_code": "bio.link_1"})

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"checkout_session_id", "checkout_url"}
    assert payload["checkout_session_id"].startswith("cs_test_")
    assert payload["checkout_url"].startswith("https://checkout.stripe.test/")

    created = fake_stripe.created_payloads[0]
    assert created["mode"] == "payment"
    assert created["line_items"][0]["quantity"] == 1
    assert created["line_items"][0]["price_data"]["unit_amount"] == 100
    assert created["line_items"][0]["price_data"]["currency"] == "gbp"
    assert created["success_url"] == "http://localhost:5173/experiment/thank-you?session_id={CHECKOUT_SESSION_ID}"
    assert created["cancel_url"] == "http://localhost:5173/experiment?checkout=cancelled"
    assert created["metadata"]["campaign_slug"] == "the-one-pound-experiment"
    assert created["metadata"]["source_code"] == "bio.link_1"


def test_source_code_validation_rejects_unsafe_values(client, monkeypatch):
    _enable_stripe(monkeypatch)
    _create_public_campaign(client)

    response = client.post("/api/public/checkout-sessions", json={"source_code": "bad code"})

    assert response.status_code == 422


def test_checkout_session_persistence_and_safe_status_response(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={}).json()

    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]).first()
        assert record is not None
        assert record.amount_total_minor == 100
        assert record.currency == "GBP"
        assert record.customer_email is None

    status_response = client.get(f"/api/public/checkout-sessions/{created['checkout_session_id']}")
    assert status_response.status_code == 200
    payload = status_response.json()
    assert set(payload) == {"status", "payment_status", "amount_total_minor", "currency", "campaign_name", "completed_at"}
    assert payload["campaign_name"] == "The £1 Experiment"
    assert "customer_email" not in payload


def test_webhook_signature_rejection(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)

    response = client.post("/api/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "invalid-signature"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Stripe webhook signature verification failed."


def test_get_metadata_handles_plain_dict_metadata():
    assert _get_metadata({"metadata": {"campaign_slug": "the-one-pound-experiment"}}) == {
        "campaign_slug": "the-one-pound-experiment"
    }


def test_get_metadata_handles_stripe_like_metadata():
    assert _get_metadata(
        FakeStripeSession(metadata=FakeStripeMetadata({"campaign_id": "cmp_123", "campaign_slug": "the-one-pound-experiment"}))
    ) == {
        "campaign_id": "cmp_123",
        "campaign_slug": "the-one-pound-experiment",
    }


def test_get_metadata_handles_real_stripe_object_metadata():
    session_obj = stripe.checkout.Session.construct_from(
        {
            "id": "cs_test_real_metadata",
            "object": "checkout.session",
            "metadata": {
                "campaign_id": "cmp_123",
                "campaign_slug": "the-one-pound-experiment",
            },
        },
        None,
    )

    assert _get_metadata(session_obj) == {
        "campaign_id": "cmp_123",
        "campaign_slug": "the-one-pound-experiment",
    }


def test_get_metadata_handles_missing_null_and_unsupported_metadata():
    assert _get_metadata({}) == {}
    assert _get_metadata({"metadata": None}) == {}
    assert _get_metadata({"metadata": ["unexpected"]}) == {}
    assert _get_metadata({"metadata": FakeStripeMetadataInvalid()}) == {}


def test_campaign_metadata_validation_accepts_string_metadata_for_uuid_campaign_id():
    session_obj = stripe.checkout.Session.construct_from(
        {
            "id": "cs_test_uuid_match",
            "object": "checkout.session",
            "amount_total": 100,
            "currency": "gbp",
            "mode": "payment",
            "metadata": {
                "campaign_id": "e01d117f-9773-4641-a1ae-bef881da4174",
                "campaign_slug": "the-one-pound-experiment",
                "experiment_type": EXPERIMENT_TYPE,
            },
        },
        None,
    )
    campaign = SimpleNamespace(
        id=UUID("e01d117f-9773-4641-a1ae-bef881da4174"),
        slug="the-one-pound-experiment",
        currency="GBP",
        target_amount_minor=100,
    )

    _ensure_checkout_session_matches_campaign(SimpleNamespace(), campaign, session_obj)


def test_campaign_metadata_validation_rejects_mismatched_string_and_uuid_ids():
    session_obj = stripe.checkout.Session.construct_from(
        {
            "id": "cs_test_uuid_mismatch",
            "object": "checkout.session",
            "amount_total": 100,
            "currency": "gbp",
            "mode": "payment",
            "metadata": {
                "campaign_id": "00000000-0000-0000-0000-000000000000",
                "campaign_slug": "the-one-pound-experiment",
                "experiment_type": EXPERIMENT_TYPE,
            },
        },
        None,
    )
    campaign = SimpleNamespace(
        id=UUID("e01d117f-9773-4641-a1ae-bef881da4174"),
        slug="the-one-pound-experiment",
        currency="GBP",
        target_amount_minor=100,
    )

    try:
        _ensure_checkout_session_matches_campaign(SimpleNamespace(), campaign, session_obj)
    except CheckoutSessionVerificationError as exc:
        assert "campaign metadata mismatch" in str(exc).lower()
    else:
        raise AssertionError("Expected campaign metadata mismatch for mismatched ids.")


def test_completed_webhook_processing_accepts_stripe_event_object_with_real_metadata_shape(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={"source_code": "bio.tiktok"}).json()
    event = _build_stripe_event(
        "evt_completed_like_object",
        {
            "id": created["checkout_session_id"],
            "object": "checkout.session",
            "payment_status": "paid",
            "status": "complete",
            "currency": "gbp",
            "amount_total": 100,
            "mode": "payment",
            "payment_intent": "pi_test_like_object",
            "customer": "cus_test_like_object",
            "customer_details": {"email": "person@example.com"},
            "metadata": {
                "campaign_id": campaign["id"],
                "campaign_slug": "the-one-pound-experiment",
                "experiment_type": "one-pound-experiment",
                "source_code": "bio.tiktok",
            },
        },
    )

    with SessionLocal() as db:
        first = process_checkout_session_completed(db, event)
    with SessionLocal() as db:
        second = process_checkout_session_completed(db, event)
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).one()
        duplicate_count = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).count()

    assert first.accepted is True
    assert first.already_processed is False
    assert second.accepted is True
    assert second.already_processed is True
    assert second.status == "completed"
    assert duplicate_count == 1
    assert record.status.value == "completed"
    assert record.payment_status == "paid"
    assert record.stripe_event_id == "evt_completed_like_object"
    assert record.stripe_payment_intent_id == "pi_test_like_object"
    assert record.customer_email == "person@example.com"


def test_completed_webhook_processing_and_duplicate_idempotency(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient(construct_stripe_event=True)
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={"source_code": "bio.tiktok"}).json()
    fake_stripe.retrieve_payloads[created["checkout_session_id"]] = FakeStripeSession(
        id=created["checkout_session_id"],
        payment_status="paid",
        status="complete",
        currency="gbp",
        amount_total=100,
        mode="payment",
        payment_intent="pi_test_1",
        customer="cus_test_1",
        customer_details={"email": "person@example.com"},
        metadata={
            "campaign_id": campaign["id"],
            "campaign_slug": "the-one-pound-experiment",
            "experiment_type": "one-pound-experiment",
            "source_code": "bio.tiktok",
        },
    )
    event = {
        "id": "evt_completed_1",
        "type": "checkout.session.completed",
        "data": {"object": dict(fake_stripe.retrieve_payloads[created["checkout_session_id"]].__dict__)},
    }

    first = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})
    second = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["already_processed"] is True

    status_response = client.get(f"/api/public/checkout-sessions/{created['checkout_session_id']}")
    assert status_response.json()["status"] == "completed"
    assert status_response.json()["payment_status"] == "paid"
    assert "person@example.com" not in json.dumps(status_response.json())

    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).one()
        duplicate_count = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).count()

    assert duplicate_count == 1
    assert record.status.value == "completed"
    assert record.payment_status == "paid"


def test_expired_webhook_processing(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={}).json()
    event = {
        "id": "evt_expired_1",
        "type": "checkout.session.expired",
        "data": {
            "object": {
                "id": created["checkout_session_id"],
                "payment_status": "unpaid",
            }
        },
    }

    response = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})

    assert response.status_code == 200
    assert client.get(f"/api/public/checkout-sessions/{created['checkout_session_id']}").json()["status"] == "expired"


def test_completed_webhook_rejects_amount_currency_and_metadata_mismatches(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={}).json()

    mismatch_cases = [
        {"id": "evt_bad_amount", "amount_total": 200, "currency": "gbp", "metadata": {"campaign_id": campaign["id"], "campaign_slug": campaign["slug"], "experiment_type": "one-pound-experiment"}, "expected": "amount mismatch"},
        {"id": "evt_bad_currency", "amount_total": 100, "currency": "usd", "metadata": {"campaign_id": campaign["id"], "campaign_slug": campaign["slug"], "experiment_type": "one-pound-experiment"}, "expected": "currency mismatch"},
        {"id": "evt_bad_metadata", "amount_total": 100, "currency": "gbp", "metadata": {"campaign_id": campaign["id"], "campaign_slug": "wrong-slug", "experiment_type": "one-pound-experiment"}, "expected": "campaign metadata mismatch"},
    ]

    for case in mismatch_cases:
        fake_stripe.retrieve_payloads[created["checkout_session_id"]] = FakeStripeSession(
            id=created["checkout_session_id"],
            payment_status="paid",
            status="complete",
            currency=case["currency"],
            amount_total=case["amount_total"],
            mode="payment",
            metadata=case["metadata"],
        )
        event = {
            "id": case["id"],
            "type": "checkout.session.completed",
            "data": {"object": dict(fake_stripe.retrieve_payloads[created["checkout_session_id"]].__dict__)},
        }
        response = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})
        assert response.status_code == 400
        assert case["expected"] in response.json()["detail"].lower()


def test_unknown_public_checkout_status_returns_404(client, monkeypatch):
    _enable_stripe(monkeypatch)

    response = client.get("/api/public/checkout-sessions/cs_missing")

    assert response.status_code == 404
