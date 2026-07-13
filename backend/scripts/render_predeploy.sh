#!/bin/sh
set -eu

echo "Running staging database migrations..."
alembic upgrade head

echo "Seeding the public experiment campaign..."
python -m app.scripts.seed_pound_experiment

echo "Render pre-deploy tasks completed successfully."
