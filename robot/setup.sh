#!/bin/sh
set -eu

cd "$(dirname "$0")"
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
if [ ! -d vendor/unitree_rl_mjlab/.git ]; then
  mkdir -p vendor
  git clone --filter=blob:none https://github.com/unitreerobotics/unitree_rl_mjlab.git vendor/unitree_rl_mjlab
fi
if [ ! -d vendor/microduck_rl/.git ]; then
  mkdir -p vendor
  git clone --filter=blob:none https://github.com/pollen-robotics/microduck_rl.git vendor/microduck_rl
fi
if [ ! -d vendor/microduck/.git ]; then
  git clone --filter=blob:none https://github.com/pollen-robotics/microduck.git vendor/microduck
fi
if [ ! -d vendor/toddlerbot/.git ]; then
  git clone --filter=blob:none https://github.com/hshi74/toddlerbot.git vendor/toddlerbot
fi
if [ ! -d vendor/handoff/.git ]; then
  git clone --filter=blob:none https://github.com/lzyang2000/HANDOFF.git vendor/handoff
fi
if [ ! -d vendor/hiking/.git ]; then
  git clone --filter=blob:none https://github.com/Haydenil/Hiking_deploy.git vendor/hiking
fi
if [ ! -d vendor/php-parkour/.git ]; then
  git clone --filter=blob:none https://github.com/php-parkour/php-parkour.github.io.git vendor/php-parkour
fi
git -C vendor/unitree_rl_mjlab fetch origin 1425b15f73bd4095f0df53709d7c389c3eb9e790
git -C vendor/unitree_rl_mjlab checkout --detach 1425b15f73bd4095f0df53709d7c389c3eb9e790
git -C vendor/microduck_rl fetch origin d424a0c899f6b33cbd3daeb279913134349c0b63
git -C vendor/microduck_rl checkout --detach d424a0c899f6b33cbd3daeb279913134349c0b63
git -C vendor/microduck fetch origin 590b986bd8c0d50ae02cb3ea2f59c463b6828168
git -C vendor/microduck checkout --detach 590b986bd8c0d50ae02cb3ea2f59c463b6828168
git -C vendor/toddlerbot fetch origin e337f3b177b4b53abff70b31d1695a7b66cc6d2e
git -C vendor/toddlerbot checkout --detach e337f3b177b4b53abff70b31d1695a7b66cc6d2e
git -C vendor/handoff fetch origin 6454ae8811f31ed722e561cb0ca7c1e432ac7ca8
git -C vendor/handoff checkout --detach 6454ae8811f31ed722e561cb0ca7c1e432ac7ca8
git -C vendor/hiking fetch origin 01d22aa1768d9eba199c7c98f2c818e6c5fa24a1
git -C vendor/hiking checkout --detach 01d22aa1768d9eba199c7c98f2c818e6c5fa24a1
git -C vendor/php-parkour fetch origin b490875b6cc74dd79e96708e726bc0dbf57e5017
git -C vendor/php-parkour checkout --detach b490875b6cc74dd79e96708e726bc0dbf57e5017
if [ ! -f artifacts/toddler/toddlerbot_2xc_walk_rsl_20251226_114612/model_best.onnx ]; then
  mkdir -p artifacts/toddler
  .venv/bin/gdown 'https://drive.google.com/uc?id=1Rcfhsw1fbqpW7CkMiqRhF2uGixuJxDtn' -O artifacts/toddler/walk.zip
  unzip -q -o artifacts/toddler/walk.zip -d artifacts/toddler
fi
.venv/bin/python export-g1.py
.venv/bin/python export.py
.venv/bin/python export-toddler.py
