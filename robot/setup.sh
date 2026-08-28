#!/bin/sh
set -eu

cd "$(dirname "$0")"
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
if [ ! -d vendor/unitree_rl_mjlab/.git ]; then
  mkdir -p vendor
  git clone --filter=blob:none https://github.com/unitreerobotics/unitree_rl_mjlab.git vendor/unitree_rl_mjlab
fi
git -C vendor/unitree_rl_mjlab fetch origin 1425b15f73bd4095f0df53709d7c389c3eb9e790
git -C vendor/unitree_rl_mjlab checkout --detach 1425b15f73bd4095f0df53709d7c389c3eb9e790
.venv/bin/python export.py
