# PocketLab Dashboard Starter

This project is a starter kit for publishing PocketLab CSV data to a simple dashboard hosted with GitHub Pages.

The intended workflow is:

1. A computer connected to the PocketLab exports data as `.csv`.
2. A local sync script copies the newest export into this repo.
3. The script commits and pushes the update to GitHub.
4. GitHub Pages publishes a webpage that reads the CSV and displays the latest data.

This avoids Google Cloud and keeps the hosting stack very simple.

## What is included

- A static dashboard in `index.html`, `styles.css`, and `app.js`
- A sample PocketLab-style CSV in `data/latest.csv`
- A local Node.js sync script in `scripts/sync-pocketlab.js`
- No third-party npm dependencies

## Folder layout

```text
.
|-- app.js
|-- data/
|   `-- latest.csv
|-- index.html
|-- package.json
|-- scripts/
|   `-- sync-pocketlab.js
`-- styles.css
```

## Dashboard features

- Reads `data/latest.csv`
- Detects numeric columns automatically
- Lets you choose which sensor column to chart
- Shows latest value, minimum, maximum, average, and row count
- Draws a simple line chart in the browser
- Works as a static site on GitHub Pages

## Requirements

- Node.js 18+
- Git installed and authenticated on the machine that will push updates
- A GitHub repository with GitHub Pages enabled

## Quick start

### 1. Preview the dashboard locally

You can open `index.html` directly, but many browsers block local `fetch()` calls for CSV files. A tiny local web server is more reliable.

If you have Node available:

```powershell
node --version
```

Then either use your preferred local server or publish the repo to GitHub Pages and test there.

### 2. Push this repo to GitHub

Create a GitHub repository, then connect this folder and push it.

Typical flow:

```powershell
git init
git branch -M main
git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
git add .
git commit -m "Initial PocketLab dashboard starter"
git push -u origin main
```

### 3. Turn on GitHub Pages

In the GitHub repository:

1. Open `Settings`
2. Open `Pages`
3. Set the source to deploy from the `main` branch
4. Publish from the repository root

Your site will then be available at a URL like:

```text
https://YOUR-ORG.github.io/YOUR-REPO/
```

## Updating the data manually

Replace `data/latest.csv` with the newest PocketLab export, then commit and push:

```powershell
git add data/latest.csv
git commit -m "Update PocketLab data"
git push
```

## Automating updates from the PocketLab computer

The script `scripts/sync-pocketlab.js` can watch a local export folder, copy the newest CSV into `data/latest.csv`, and then run `git add`, `git commit`, and `git push`.

Example:

```powershell
node .\scripts\sync-pocketlab.js ^
  --source-dir "C:\PocketLab\exports" ^
  --watch ^
  --interval 30
```

If you want the script to only copy the file and skip Git commands:

```powershell
node .\scripts\sync-pocketlab.js ^
  --source-dir "C:\PocketLab\exports" ^
  --no-push
```

## Script behavior

- Finds the newest `.csv` file in the source folder
- Copies it to `data/latest.csv`
- Saves metadata in `.sync-state.json`
- Skips unchanged files
- Optionally archives processed files into `archive/`
- Optionally commits and pushes with Git

## Recommended deployment setup

- Leave one computer connected to the PocketLab
- Export PocketLab recordings into a known folder
- Run the sync script on login or through Task Scheduler
- Let GitHub Pages serve the latest `data/latest.csv`

## Notes about PocketLab data

PocketLab CSV files can vary a bit by export source and sensor type. The dashboard is intentionally flexible:

- It uses the first row as headers
- It tries to infer numeric sensor columns automatically
- It uses the first column as the default x-axis

If your real CSV headers differ from the sample, the page should still work as long as the file is a normal comma-separated table with headers.

## Next improvements

- Add multiple charts on one page
- Preserve historical CSV files instead of only `latest.csv`
- Add a status badge showing the last sync time
- Add GitHub Actions validation for CSV updates
- Add a greenhouse-specific layout with temperature, humidity, and light cards
