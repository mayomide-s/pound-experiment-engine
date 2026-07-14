import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import stripe

from app.config import get_settings
from app.db.session import SessionLocal
from app.models import Campaign, CheckoutSessionRecord, CheckoutSessionRecordStatus
from app.services.payment_service import (
    EXPERIMENT_TYPE,
    CheckoutSessionVerificationError,
    _ensure_checkout_session_matches_campaign,
    _get_metadata,
    generate_referral_code,
    normalize_referral_code,
    normalize_source_code,
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


def _create_public_campaign(client, slug: str = "the-one-pound-experiment", headers: dict | None = None) -> dict:
    response = client.post("/api/campaigns", json=_campaign_payload(slug), headers=headers)
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


def _enable_stripe(monkeypatch, slug: str = "the-one-pound-experiment"):
    monkeypatch.setenv("STRIPE_ENABLED", "true")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("PUBLIC_SITE_BASE_URL", "http://localhost:5173/")
    monkeypatch.setenv("PUBLIC_EXPERIMENT_CAMPAIGN_SLUG", slug)
    get_settings.cache_clear()


def _enable_auth(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("APP_ACCESS_PASSWORD", "open-sesame")
    monkeypatch.setenv("APP_SESSION_SECRET", "session-secret")
    get_settings.cache_clear()


def _auth_headers(client):
    login = client.post("/api/access/login", json={"password": "open-sesame"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['token']}"}


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

    response = client.post(
        "/api/public/checkout-sessions",
        json={"source_code": " TikTok_Ad ", "referral_code": "r_ab12cd34"},
    )

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
    assert created["success_url"] == "http://localhost:5173/experiment/thank-you?session_id={CHECKOUT_SESSION_ID}&source=tiktok_ad&ref=r_ab12cd34"
    assert created["cancel_url"] == "http://localhost:5173/experiment?checkout=cancelled&source=tiktok_ad&ref=r_ab12cd34"
    assert created["metadata"]["campaign_slug"] == "the-one-pound-experiment"
    assert created["metadata"]["source_code"] == "tiktok_ad"
    assert created["metadata"]["referring_referral_code"] == "r_ab12cd34"


def test_source_code_invalid_values_fall_back_to_direct(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)

    response = client.post(
        "/api/public/checkout-sessions",
        json={"source_code": "bad code", "referral_code": "bad-ref.code"},
    )

    assert response.status_code == 200
    created = fake_stripe.created_payloads[0]
    assert created["metadata"]["source_code"] == "direct"
    assert "referring_referral_code" not in created["metadata"]
    assert created["success_url"] == "http://localhost:5173/experiment/thank-you?session_id={CHECKOUT_SESSION_ID}"
    assert created["cancel_url"] == "http://localhost:5173/experiment?checkout=cancelled"


def test_valid_referral_attribution_is_stored_separately_from_source(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)

    response = client.post(
        "/api/public/checkout-sessions",
        json={"source_code": "newsletter", "referral_code": "r_seed1234"},
    )

    assert response.status_code == 200
    created = fake_stripe.created_payloads[0]
    assert created["metadata"]["source_code"] == "newsletter"
    assert created["metadata"]["referring_referral_code"] == "r_seed1234"

    checkout_session_id = response.json()["checkout_session_id"]
    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == checkout_session_id
        ).one()
        assert record.source_code == "newsletter"
        assert record.referring_referral_code == "r_seed1234"


def test_normalize_source_code_rules():
    assert normalize_source_code(None) == "direct"
    assert normalize_source_code("") == "direct"
    assert normalize_source_code("  TikTok  ") == "tiktok"
    assert normalize_source_code("reddit_thread_1") == "reddit_thread_1"
    assert normalize_source_code("bad.code") == "direct"
    assert normalize_source_code("bad code") == "direct"
    assert normalize_source_code("x" * 65) == "direct"


def test_normalize_referral_code_rules_and_generated_format():
    assert normalize_referral_code(None) is None
    assert normalize_referral_code("") is None
    assert normalize_referral_code("  ") is None
    assert normalize_referral_code("r_ab12cd34") == "r_ab12cd34"
    assert normalize_referral_code("r_BAD-Code_123") == "r_bad-code_123"
    assert normalize_referral_code("r_bad.code") is None
    assert normalize_referral_code("badprefix") is None
    assert normalize_referral_code("r_" + ("x" * 31)) is None

    generated = generate_referral_code()
    assert generated.startswith("r_")
    assert len(generated) == 10
    assert normalize_referral_code(generated) == generated


def test_checkout_session_persistence_and_safe_status_response(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={"referral_code": "r_friend001"}).json()

    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]).first()
        assert record is not None
        assert record.amount_total_minor == 100
        assert record.currency == "GBP"
        assert record.customer_email is None
        assert record.source_code == "direct"
        assert record.referring_referral_code == "r_friend001"
        assert record.referral_code is None

    status_response = client.get(f"/api/public/checkout-sessions/{created['checkout_session_id']}")
    assert status_response.status_code == 200
    payload = status_response.json()
    assert set(payload) == {"status", "payment_status", "amount_total_minor", "currency", "campaign_name", "completed_at", "referral_code"}
    assert payload["campaign_name"] == "The £1 Experiment"
    assert payload["referral_code"] is None
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
    created = client.post("/api/public/checkout-sessions", json={"source_code": "bio_tiktok"}).json()
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
                "source_code": "bio_tiktok",
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
    assert normalize_referral_code(record.referral_code) == record.referral_code
    assert record.stripe_event_id == "evt_completed_like_object"
    assert record.stripe_payment_intent_id == "pi_test_like_object"
    assert record.customer_email == "person@example.com"


def test_completed_webhook_processing_and_duplicate_idempotency(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient(construct_stripe_event=True)
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={"source_code": "bio_tiktok"}).json()
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
            "source_code": "bio_tiktok",
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
    assert normalize_referral_code(status_response.json()["referral_code"]) == status_response.json()["referral_code"]
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
    assert record.referral_code == status_response.json()["referral_code"]


def test_completed_webhook_referral_code_generation_skips_existing_codes(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={}).json()

    with SessionLocal() as db:
        db.add(
            CheckoutSessionRecord(
                campaign_id=campaign["id"],
                stripe_checkout_session_id="cs_existing_referral",
                status=CheckoutSessionRecordStatus.COMPLETED,
                currency="GBP",
                amount_total_minor=100,
                payment_status="paid",
                referral_code="r_repeat01",
                metadata_json={},
            )
        )
        db.commit()

    fake_stripe.retrieve_payloads[created["checkout_session_id"]] = FakeStripeSession(
        id=created["checkout_session_id"],
        payment_status="paid",
        status="complete",
        currency="gbp",
        amount_total=100,
        mode="payment",
        payment_intent="pi_collision_case",
        customer="cus_collision_case",
        customer_details={"email": "person@example.com"},
        metadata={
            "campaign_id": campaign["id"],
            "campaign_slug": campaign["slug"],
            "experiment_type": EXPERIMENT_TYPE,
            "source_code": "direct",
        },
    )

    generated_codes = iter(["r_repeat01", "r_unique02"])
    monkeypatch.setattr(
        "app.services.payment_service.generate_referral_code",
        lambda: next(generated_codes),
    )

    event = {
        "id": "evt_completed_collision",
        "type": "checkout.session.completed",
        "data": {"object": dict(fake_stripe.retrieve_payloads[created["checkout_session_id"]].__dict__)},
    }

    response = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})

    assert response.status_code == 200
    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).one()
        assert record.referral_code == "r_unique02"


def test_historical_completed_records_without_referral_code_remain_valid(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    campaign = _create_public_campaign(client, slug=slug)

    with SessionLocal() as db:
        db.add(
            CheckoutSessionRecord(
                campaign_id=campaign["id"],
                stripe_checkout_session_id="cs_historical_completed",
                status=CheckoutSessionRecordStatus.COMPLETED,
                currency="GBP",
                amount_total_minor=100,
                payment_status="paid",
                source_code="direct",
                completed_at=None,
                metadata_json={},
            )
        )
        db.commit()

    response = client.get("/api/public/checkout-sessions/cs_historical_completed")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["payment_status"] == "paid"
    assert payload["referral_code"] is None


def test_completed_historical_record_without_referral_code_is_backfilled_once(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client, slug=slug)

    with SessionLocal() as db:
        db.add(
            CheckoutSessionRecord(
                campaign_id=campaign["id"],
                stripe_checkout_session_id="cs_historical_backfill",
                status=CheckoutSessionRecordStatus.COMPLETED,
                currency="GBP",
                amount_total_minor=100,
                payment_status="paid",
                source_code="newsletter",
                completed_at=None,
                stripe_event_id="evt_historical_old",
                metadata_json={},
            )
        )
        db.commit()

    event = _build_stripe_event(
        "evt_historical_backfill",
        {
            "id": "cs_historical_backfill",
            "object": "checkout.session",
            "payment_status": "paid",
            "status": "complete",
            "currency": "gbp",
            "amount_total": 100,
            "mode": "payment",
            "payment_intent": "pi_historical_backfill",
            "customer": "cus_historical_backfill",
            "customer_details": {"email": "person@example.com"},
            "metadata": {
                "campaign_id": campaign["id"],
                "campaign_slug": campaign["slug"],
                "experiment_type": EXPERIMENT_TYPE,
                "source_code": "newsletter",
            },
        },
    )

    with SessionLocal() as db:
        first = process_checkout_session_completed(db, event)
    with SessionLocal() as db:
        second = process_checkout_session_completed(db, event)
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == "cs_historical_backfill"
        ).one()

    assert first.accepted is True
    assert first.already_processed is False
    assert second.accepted is True
    assert second.already_processed is True
    assert normalize_referral_code(record.referral_code) == record.referral_code
    assert record.stripe_event_id == "evt_historical_backfill"


def test_completed_webhook_referral_code_generation_fails_safely_after_bounded_retries(client, monkeypatch):
    _enable_stripe(monkeypatch)
    fake_stripe = FakeStripeClient()
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)
    campaign = _create_public_campaign(client)
    created = client.post("/api/public/checkout-sessions", json={}).json()

    repeated_code = "r_bounddup1"
    with SessionLocal() as db:
        db.add(
            CheckoutSessionRecord(
                campaign_id=campaign["id"],
                stripe_checkout_session_id="cs_existing_referral_bounded",
                status=CheckoutSessionRecordStatus.COMPLETED,
                currency="GBP",
                amount_total_minor=100,
                payment_status="paid",
                referral_code=repeated_code,
                metadata_json={},
            )
        )
        db.commit()

    fake_stripe.retrieve_payloads[created["checkout_session_id"]] = FakeStripeSession(
        id=created["checkout_session_id"],
        payment_status="paid",
        status="complete",
        currency="gbp",
        amount_total=100,
        mode="payment",
        payment_intent="pi_collision_bounded",
        customer="cus_collision_bounded",
        customer_details={"email": "person@example.com"},
        metadata={
            "campaign_id": campaign["id"],
            "campaign_slug": campaign["slug"],
            "experiment_type": EXPERIMENT_TYPE,
            "source_code": "direct",
        },
    )
    monkeypatch.setattr(
        "app.services.payment_service.generate_referral_code",
        lambda: repeated_code,
    )

    event = {
        "id": "evt_completed_collision_bounded",
        "type": "checkout.session.completed",
        "data": {"object": dict(fake_stripe.retrieve_payloads[created["checkout_session_id"]].__dict__)},
    }

    response = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})

    assert response.status_code == 400
    assert "unable to allocate a unique referral code" in response.json()["detail"].lower()
    with SessionLocal() as db:
        record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == created["checkout_session_id"]
        ).one()
        assert record.status.value == "open"
        assert record.referral_code is None


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


def test_public_experiment_stats_returns_zero_when_no_completed_payments(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    _create_public_campaign(client, slug=slug)
    client.post("/api/public/checkout-sessions", json={"source_code": "tiktok"})

    response = client.get("/api/public/experiment-stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["campaign_slug"] == slug
    assert payload["participant_count"] == 0
    assert payload["amount_collected_minor"] == 0
    assert payload["currency"] == "GBP"
    assert payload["updated_at"].endswith("Z")


def test_public_experiment_stats_and_admin_analytics_include_completed_paid_checkouts_only(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    campaign = _create_public_campaign(client, slug=slug)
    _enable_auth(monkeypatch)
    fake_stripe = FakeStripeClient(construct_stripe_event=True)
    monkeypatch.setattr("app.services.payment_service.get_stripe_client", lambda: fake_stripe)

    completed_ids = []
    for source_code, referral_code in [
        ("reddit", "r_seedalpha"),
        ("reddit", "r_seedalpha"),
        ("direct", "r_seedbeta"),
    ]:
        created = client.post(
            "/api/public/checkout-sessions",
            json={"source_code": source_code, "referral_code": referral_code},
        ).json()
        completed_ids.append(created["checkout_session_id"])
        fake_stripe.retrieve_payloads[created["checkout_session_id"]] = FakeStripeSession(
            id=created["checkout_session_id"],
            payment_status="paid",
            status="complete",
            currency="gbp",
            amount_total=100,
            mode="payment",
            payment_intent=f"pi_{source_code}_{created['checkout_session_id']}",
            customer=f"cus_{source_code}_{created['checkout_session_id']}",
            customer_details={"email": "person@example.com"},
            metadata={
                "campaign_id": campaign["id"],
                "campaign_slug": campaign["slug"],
                "experiment_type": EXPERIMENT_TYPE,
                "source_code": source_code,
                "referring_referral_code": referral_code,
            },
        )

    open_session = client.post(
        "/api/public/checkout-sessions",
        json={"source_code": "newsletter", "referral_code": "r_seedbeta"},
    ).json()

    for index, checkout_session_id in enumerate(completed_ids):
        event = {
            "id": f"evt_completed_stats_{index}",
            "type": "checkout.session.completed",
            "data": {"object": dict(fake_stripe.retrieve_payloads[checkout_session_id].__dict__)},
        }
        response = client.post("/api/webhooks/stripe", content=json.dumps(event), headers={"Stripe-Signature": "valid-signature"})
        assert response.status_code == 200

    replay_event = {
        "id": "evt_completed_stats_0",
        "type": "checkout.session.completed",
        "data": {"object": dict(fake_stripe.retrieve_payloads[completed_ids[0]].__dict__)},
    }
    replay_response = client.post("/api/webhooks/stripe", content=json.dumps(replay_event), headers={"Stripe-Signature": "valid-signature"})
    assert replay_response.status_code == 200
    assert replay_response.json()["already_processed"] is True

    public_response = client.get("/api/public/experiment-stats")
    assert public_response.status_code == 200
    public_payload = public_response.json()
    assert public_payload["participant_count"] == 3
    assert public_payload["amount_collected_minor"] == 300
    assert public_payload["currency"] == "GBP"

    admin_response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))
    assert admin_response.status_code == 200
    admin_payload = admin_response.json()
    assert admin_payload["campaign_slug"] == slug
    assert admin_payload["checkout_sessions_started"] == 4
    assert admin_payload["completed_payments"] == 3
    assert admin_payload["payments_today"] == 3
    assert admin_payload["amount_collected_minor"] == 300
    assert admin_payload["currency"] == "GBP"
    assert admin_payload["conversion_rate"] == 0.75
    assert admin_payload["referred_checkout_sessions"] == 4
    assert admin_payload["referred_completed_payments"] == 3
    assert admin_payload["referral_conversion_rate"] == 0.75
    assert admin_payload["top_sources"][0]["source_code"] == "reddit"
    assert admin_payload["top_sources"][0]["checkout_sessions_started"] == 2
    assert admin_payload["top_sources"][0]["completed_payments"] == 2
    assert admin_payload["top_sources"][0]["amount_collected_minor"] == 200
    assert any(item["source_code"] == "newsletter" and item["completed_payments"] == 0 for item in admin_payload["top_sources"])
    assert admin_payload["top_referrers"][0]["referral_code"] == "r_seedalpha"
    assert admin_payload["top_referrers"][0]["checkout_sessions_started"] == 2
    assert admin_payload["top_referrers"][0]["completed_payments"] == 2
    assert admin_payload["top_referrers"][0]["amount_collected_minor"] == 200
    assert any(
        item["referral_code"] == "r_seedbeta"
        and item["checkout_sessions_started"] == 2
        and item["completed_payments"] == 1
        for item in admin_payload["top_referrers"]
    )
    assert len(admin_payload["recent_payments"]) == 3
    assert all(item["amount_minor"] == 100 for item in admin_payload["recent_payments"])
    assert all("person@example.com" not in json.dumps(item) for item in admin_payload["recent_payments"])
    assert all("pi_" not in json.dumps(item) and "cus_" not in json.dumps(item) for item in admin_payload["top_referrers"])

    with SessionLocal() as db:
        completed_record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == completed_ids[0]
        ).one()
        open_record = db.query(CheckoutSessionRecord).filter(
            CheckoutSessionRecord.stripe_checkout_session_id == open_session["checkout_session_id"]
        ).one()

    assert completed_record.status.value == "completed"
    assert completed_record.payment_status == "paid"
    assert normalize_referral_code(completed_record.referral_code) == completed_record.referral_code
    assert open_record.status.value == "open"


def test_admin_experiment_analytics_requires_auth(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    _create_public_campaign(client, slug=slug)
    _enable_auth(monkeypatch)

    response = client.get("/api/admin/experiment-analytics")

    assert response.status_code == 401


def test_experiment_analytics_endpoints_return_503_when_campaign_missing(client, monkeypatch):
    slug = f"missing-public-campaign-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    _enable_auth(monkeypatch)

    public_response = client.get("/api/public/experiment-stats")
    admin_response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert public_response.status_code == 503
    assert admin_response.status_code == 503


def test_experiment_analytics_endpoints_return_503_when_stripe_disabled(client, monkeypatch):
    _enable_auth(monkeypatch)

    public_response = client.get("/api/public/experiment-stats")
    admin_response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert public_response.status_code == 503
    assert admin_response.status_code == 503


def test_admin_analytics_referral_conversion_is_zero_when_no_referred_sessions(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    _create_public_campaign(client, slug=slug)
    _enable_auth(monkeypatch)

    response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert response.status_code == 200
    payload = response.json()
    assert payload["referred_checkout_sessions"] == 0
    assert payload["referred_completed_payments"] == 0
    assert payload["referral_conversion_rate"] == 0
    assert payload["top_referrers"] == []


def test_admin_analytics_merges_legacy_invalid_sources_under_direct(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    campaign = _create_public_campaign(client, slug=slug)

    with SessionLocal() as db:
        for stripe_checkout_session_id, source_code in [
            ("cs_legacy_direct_null", None),
            ("cs_legacy_direct_bad", "bad.code"),
            ("cs_legacy_direct_upper", "DIRECT"),
        ]:
            db.add(
                CheckoutSessionRecord(
                    campaign_id=campaign["id"],
                    stripe_checkout_session_id=stripe_checkout_session_id,
                    status=CheckoutSessionRecordStatus.COMPLETED,
                    currency="GBP",
                    amount_total_minor=100,
                    payment_status="paid",
                    source_code=source_code,
                    completed_at=None,
                    metadata_json={},
                )
            )
        db.commit()

    _enable_auth(monkeypatch)
    response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert response.status_code == 200
    payload = response.json()
    direct_rows = [row for row in payload["top_sources"] if row["source_code"] == "direct"]
    assert len(direct_rows) == 1
    assert direct_rows[0]["checkout_sessions_started"] == 3
    assert direct_rows[0]["completed_payments"] == 3
    assert direct_rows[0]["amount_collected_minor"] == 300


def test_admin_analytics_normalizes_legacy_referral_codes_and_excludes_invalid_values(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    campaign = _create_public_campaign(client, slug=slug)

    with SessionLocal() as db:
        for stripe_checkout_session_id, referring_referral_code, amount_total_minor, payment_status in [
            ("cs_referral_upper_a", "R_SEEDALPHA", 100, "paid"),
            ("cs_referral_upper_b", "r_seedalpha", 250, "paid"),
            ("cs_referral_invalid", "bad.ref", 500, "paid"),
            ("cs_referral_unpaid", "r_seedbeta", 100, "unpaid"),
        ]:
            db.add(
                CheckoutSessionRecord(
                    campaign_id=campaign["id"],
                    stripe_checkout_session_id=stripe_checkout_session_id,
                    status=CheckoutSessionRecordStatus.COMPLETED,
                    currency="GBP",
                    amount_total_minor=amount_total_minor,
                    payment_status=payment_status,
                    source_code="direct",
                    referring_referral_code=referring_referral_code,
                    referral_code=f"r_owner_{stripe_checkout_session_id[-3:]}",
                    completed_at=None,
                    metadata_json={},
                )
            )
        db.commit()

    _enable_auth(monkeypatch)
    response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert response.status_code == 200
    payload = response.json()
    assert payload["referred_checkout_sessions"] == 3
    assert payload["referred_completed_payments"] == 2
    assert payload["referral_conversion_rate"] == 2 / 3
    assert payload["top_referrers"][0] == {
        "referral_code": "r_seedalpha",
        "checkout_sessions_started": 2,
        "completed_payments": 2,
        "amount_collected_minor": 350,
    }
    assert all(row["referral_code"] != "bad.ref" for row in payload["top_referrers"])


def test_admin_analytics_top_referrers_are_limited_and_deterministic(client, monkeypatch):
    slug = f"the-one-pound-experiment-{uuid4().hex[:8]}"
    _enable_stripe(monkeypatch, slug=slug)
    campaign = _create_public_campaign(client, slug=slug)

    with SessionLocal() as db:
        rows: list[CheckoutSessionRecord] = []
        for index in range(12):
            rows.append(
                CheckoutSessionRecord(
                    campaign_id=campaign["id"],
                    stripe_checkout_session_id=f"cs_ref_top_{index}",
                    status=CheckoutSessionRecordStatus.COMPLETED,
                    currency="GBP",
                    amount_total_minor=100,
                    payment_status="paid",
                    source_code="direct",
                    referring_referral_code=f"r_code{index:02d}",
                    referral_code=f"r_owner{index:02d}",
                    completed_at=None,
                    metadata_json={},
                )
            )
        rows.append(
            CheckoutSessionRecord(
                campaign_id=campaign["id"],
                stripe_checkout_session_id="cs_ref_top_bonus",
                status=CheckoutSessionRecordStatus.COMPLETED,
                currency="GBP",
                amount_total_minor=100,
                payment_status="paid",
                source_code="direct",
                referring_referral_code="r_code00",
                referral_code="r_owner_bonus",
                completed_at=None,
                metadata_json={},
            )
        )
        db.add_all(rows)
        db.commit()

    _enable_auth(monkeypatch)
    response = client.get("/api/admin/experiment-analytics", headers=_auth_headers(client))

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["top_referrers"]) == 10
    assert payload["top_referrers"][0]["referral_code"] == "r_code00"
    assert payload["top_referrers"][0]["completed_payments"] == 2
    remaining_codes = [row["referral_code"] for row in payload["top_referrers"][1:]]
    assert remaining_codes == [f"r_code{index:02d}" for index in range(1, 10)]
