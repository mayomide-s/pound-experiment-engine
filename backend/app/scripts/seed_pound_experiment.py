from __future__ import annotations

from app.db.session import SessionLocal
from app.models import Campaign, CampaignStatus


CAMPAIGN_SLUG = "the-one-pound-experiment"


def main() -> None:
    with SessionLocal() as db:
        campaign = db.query(Campaign).filter(Campaign.slug == CAMPAIGN_SLUG).first()
        if campaign is None:
            campaign = Campaign(slug=CAMPAIGN_SLUG)
            db.add(campaign)

        campaign.name = "The £1 Experiment"
        campaign.core_question = "Would you give a stranger £1?"
        campaign.description = (
            "A transparent internet social experiment measuring what percentage of people voluntarily "
            "send £1 to a stranger simply because they were asked."
        )
        campaign.currency = "GBP"
        campaign.target_amount_minor = 100
        campaign.target_reach = 10000000
        campaign.status = CampaignStatus.DRAFT
        campaign.target_platforms_json = ["tiktok", "instagram", "youtube"]
        campaign.content_rules_json = {
            "rules": [
                "no charity claims",
                "no fabricated donor claims",
                "no fake statistics",
                "no financial-return claims",
                "clearly disclose that no product is being sold",
                "clearly describe payment as voluntary participation in the experiment",
            ]
        }
        db.commit()
        db.refresh(campaign)

    print(f"Campaign ready: {campaign.id} ({campaign.slug})")


if __name__ == "__main__":
    main()
