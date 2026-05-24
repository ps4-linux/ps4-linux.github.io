# ps4-linux

ps4-linux is a ProtonDB-style compatibility database for PlayStation 4.  
It is a static site with static JSON API endpoints generated from per-title JSON files.

## Data model (PR workflow)

Use one file per entry:

- `games/*.json` — game compatibility reports
- `apps/*.json` — app compatibility reports
- `distros/*.json` — Linux distro ports (`family`: alpine, arch, fedora, atomic, debian, other)
- `kernels/*.json` — custom kernels
- `initramfs/*.json` — initramfs bundles
- `templates/*.template.json` — starters for each kind
- `templates/entry.schema.json` — field definitions for games/apps

Open a pull request with your new JSON file.  
GitHub Actions validates JSON, rebuilds the index, and redeploys Pages on push.

`proton` is optional (especially for apps).  
If omitted, games default to `Proton 11.0 ARM64/LOCAL` and apps keep it blank.

Required on every report: `distro`, `kernel`, and `model`/`models` (pro/slim/fat).  
Optional but encouraged: `storage`, `fps`, `resolution`, `performance`, and a `proof` link (https URL, not embedded).

## Commands

- `npm run dev` - generate API and run local dev server
- `npm run validate:data` - validate all JSON submissions only
- `npm run build:data` - build API JSON output in `public/api/`
- `npm run build` - build site for production

## API endpoints

- `/api/index.json` - full payload and stats
- `/api/games.json` - only games
- `/api/apps.json` - only apps
- `/api/distros.json` - Linux distro ports
- `/api/kernels.json` - custom kernels
- `/api/initramfs.json` - initramfs bundles
- `/api/items/<id>.json` - per-title endpoint

## Support policy

- Most supported platforms: Aeolia and Belize. Baikal was recently upstreamed from 5.4 to 7.0 by rmuxnet and may remain unstable until further testing.
- ps4-linux accepts only open-source kernel trees with public source and attribution. Kernels distributed without upstream source or attribution (e.g., KHEOPS-style closed forks) are unsupported — reports using those kernels may be ignored and maintainers will not assist with troubleshooting.

