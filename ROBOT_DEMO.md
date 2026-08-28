# local voxbot demo

This runs a Unitree G1 locomotion policy on CPU in MuJoCo and renders the robot inside the normal Voxels game. The game still owns parcel streaming, feature loading, rendering, cameras, and collision lifecycle.

No NVIDIA GPU is needed. The verified machine was an Apple Silicon Mac with 128 GB RAM. The policy loop ran faster than real time on CPU.

## setup

Use Node 25, pnpm 9.15.4, Python 3.11, and PostgreSQL 18.

```sh
pnpm install --frozen-lockfile
./robot/setup.sh
```

`robot/setup.sh` creates `robot/.venv`, installs the pinned Python packages, checks out Unitree's `unitree_rl_mjlab` at commit `1425b15f73bd4095f0df53709d7c389c3eb9e790` under `robot/vendor/`, and exports the G1 mesh for the browser. The MuJoCo model and ONNX velocity policy come from that Apache-2.0 repository.

Create `.env` from `.env.example` and point it at the local database. This demo used PostgreSQL 18 on port 5433:

```env
DATABASE_URL=postgres://localhost:5433/voxels?sslmode=disable
JWT_SECRET=local-voxbot
CONTRACT_ADDRESS=0x79986aF15539de2db9A5086382daEdA917A9CF0C
```

For a new database:

```sh
/opt/homebrew/opt/postgresql@18/bin/createdb -p 5433 voxels
gunzip -c db/import.sql.gz | /opt/homebrew/opt/postgresql@18/bin/psql -v ON_ERROR_STOP=1 -p 5433 -d voxels
```

## launch

Run these in separate terminals:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /tmp/voxbot-postgres18.log -o '-p 5433' start
```

```sh
pnpm run server:start
```

```sh
pnpm run compile-css
pnpm run webpack:web:start
```

Open the robot demo parcel and let the normal game finish loading it:

```text
http://localhost:9000/play?coords=712E%2C742S&robot=1&ui=off
```

Then start MuJoCo:

```sh
./robot/run.sh
```

The browser reconnects automatically if the robot process starts later or restarts. Remove `robot=1` to run the unchanged normal player controls.

## controls

- WASD or the arrow keys walks and turns the robot. Manual input cancels an active target.
- Mouse look aims the robot while walking.
- Space performs a short assisted hop. The downloaded policy has no learned jump, so the sidecar adds a small impulse and damps roll and pitch until landing.
- R immediately respawns the G1 at its last safe standing pose. Falls also recover automatically after 1.5 seconds.
- G sends the robot toward the world point under the cursor. It follows a coarse A* path until manual input takes over.
- C switches between third person and a first-person camera fixed to the G1's head.
- F toggles flight. Space or Page Up rises; V or Page Down falls. Flight is a direct physics override, not learned locomotion.
- H shows the exact collision cuboids currently active in MuJoCo.

## what is mirrored

- Parcel collision is read from the exact occupied voxel coordinates already produced by `voxelCollider`. Adjacent cells are greedily merged only when the merged cuboid is the exact same occupied volume.
- Collidable `.vox` models request collider data from the existing importer. Their occupied source voxels are exactly merged into local cuboids, then transformed by the loaded feature mesh's position, rotation, and scale.
- Parcel and feature collision is removed when the normal game unloads the corresponding object.
- MuJoCo keeps up to 20,000 loaded cuboids for pathfinding and maps 1,500 nearby boxes into size-bucketed movable collision bodies. Each size bucket reserves its nearest geometry before lending spare slots to smaller boxes, and overlong cuboids are split instead of dropped. Selection uses 3D distance to the robot and skips redundant ground-plane boxes, so nearby walls, stairs, elevated floors, and collidable `.vox` geometry win the physical slots. The window refreshes every 0.5 m without recompiling as parcel chunks stream. The geometry-heavy verified parcel produced 3,709 parcel boxes and 12,567 `.vox` boxes in the browser.

The sidecar uses eight-direction A* navigation when G sets a destination, plans long trips in 10 m segments, and replans after four seconds without progress. Manual controls send local velocity and facing commands directly to the policy. A physical shove periodically creates a visible stumble. A fallen body releases its motors, remains down for 2.5 seconds, then resets at its last safe pose.

## recording

The checked demo was recorded with `agent-browser` after the parcel had loaded:

```sh
mkdir -p robot/artifacts
agent-browser --session voxbot record start "$PWD/robot/artifacts/voxbot-demo.webm"
agent-browser --session voxbot wait 18000
agent-browser --session voxbot record stop
```

Verified local artifact:

- `robot/artifacts/voxbot-g1-controls-2026-08-28.webm` - 37 seconds, 1070x720. It shows cursor-target walking, the G1 stumbling, and the head-mounted camera.
- `robot/artifacts/voxbot-g1-demo-2026-08-28.webm` - the earlier autonomous G1 mesh test.

These artifacts are intentionally ignored by git. Their absolute paths in this checkout are:

```text
/Users/nicecube/Desktop/voxbot/robot/artifacts/voxbot-g1-demo-2026-08-28.webm
/Users/nicecube/Desktop/voxbot/robot/artifacts/voxbot-g1-controls-2026-08-28.webm
```

## verified behavior

- The normal PostgreSQL-backed Voxels server and webpack client ran locally.
- The shipped ONNX policy drove the 29-joint G1 in MuJoCo on Apple Silicon CPU.
- The G1 mesh follows the simulated MuJoCo body transforms in third person.
- The normal camera and loading anchor followed the robot across parcel boundaries.
- Parcel and collidable `.vox` geometry were both present in the MuJoCo collision pool.
- G selected a real destination under the browser cursor and the planner physically attempted it. Success is not expected.
- Live logs showed target selection, `robot stumbled`, `robot fell`, and `robot respawned`.
