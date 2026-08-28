#!/bin/sh
set -eu

cd "$(dirname "$0")"
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
if [ ! -d vendor/microduck_rl/.git ]; then
  mkdir -p vendor
  git clone --filter=blob:none https://github.com/pollen-robotics/microduck_rl.git vendor/microduck_rl
fi
if [ ! -d vendor/microduck/.git ]; then
  git clone --filter=blob:none https://github.com/pollen-robotics/microduck.git vendor/microduck
fi
git -C vendor/microduck_rl fetch origin d424a0c899f6b33cbd3daeb279913134349c0b63
git -C vendor/microduck_rl checkout --detach d424a0c899f6b33cbd3daeb279913134349c0b63
git -C vendor/microduck fetch origin 590b986bd8c0d50ae02cb3ea2f59c463b6828168
git -C vendor/microduck checkout --detach 590b986bd8c0d50ae02cb3ea2f59c463b6828168
.venv/bin/python export.py
