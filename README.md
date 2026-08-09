# FIVE — 5×5 Log

Personal strength training app, StrongLifts-5×5 style with back-friendly exercise swaps. Plain HTML/CSS/JS, hosted on GitHub Pages, data stored in this repo.

**Live app:** https://fabianb88.github.io/Fitnessapp/

## Program

| Workout A | Workout B |
|---|---|
| Box Squat 5×5 | Box Squat 5×5 |
| Bench Press 5×5 | Overhead Press 5×5 |
| Seated Row 5×5 | Leg Press 5×5 |
| Leg Curl 3×10 | Lat Pulldown 3×8 |

Train 3×/week, alternating A and B.

## Rules (classic linear progression)

- Tap a circle when a set is done; each extra tap lowers the rep count.
- All reps completed → that exercise goes up next time (+2.5 kg, leg press +5 kg).
- Missed reps → same weight next time.
- Missed 3 times in a row → deload 10 % and build back up.

## Data & sync

- Everything is stored in `localStorage` on your phone.
- Optional GitHub sync writes `data/log.json` to this repo via the GitHub API, using a fine-grained personal access token (scoped to this repo only, Contents read/write) that you paste in Settings. The token stays on your device.

## Development

No build step. Serve the folder with any static server:

```
python -m http.server 8000
```
